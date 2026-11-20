import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/db";
import { conversationMessages, deliberationSessions, knowledgeEntries } from "@/db/schema";
import { getRoster, requireActive, RosterError } from "@/lib/executive-profile-store";
import { getActiveOpencodeConfig } from "@/lib/opencode-config";
import { generateExecutiveDeliberationTurn } from "@/lib/opencode";
import { planDeliberationStep } from "@/lib/turn-planner";
import { requireCeoConsole } from "../../executive-profiles/access";
import {
  getExecutiveRecall,
  getPersonaContext,
  ensureMemoryBackfill,
  persistMemoriesFor,
  runMemorySync,
} from "@/lib/memory";
import { makeRolePrincipal, retrieveEnterpriseKnowledge } from "@/lib/enterprise-knowledge";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let snapshot: { sessionId: number; lastMessageId: number } | undefined;
  try {
    const denied = await requireCeoConsole(req);
    if (denied) return denied;
    const body = (await req.json()) as { sessionId?: number };
    const sessionId = Number(body.sessionId);
    if (!sessionId) {
      return NextResponse.json({ error: "Valid sessionId is required" }, { status: 400 });
    }

    const [session] = await db
      .select()
      .from(deliberationSessions)
      .where(eq(deliberationSessions.id, sessionId))
      .limit(1);
    if (!session) {
      return NextResponse.json({ error: "Deliberation session not found" }, { status: 404 });
    }

    const priorMessages = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.sessionId, sessionId))
      .orderBy(asc(conversationMessages.id));

    snapshot = { sessionId, lastMessageId: priorMessages.at(-1)?.id ?? 0 };
    const config = await getActiveOpencodeConfig();
    const roster = getRoster();
    const plan = planDeliberationStep(
      roster,
      priorMessages,
      config.walkTalkRounds,
      session.ceoQuestion,
    );
    if (!plan)
      throw new RosterError(
        "No active recipient. Add an executive or retarget the CEO question.",
        409,
      );
    const speaker = requireActive(plan.speaker);
    const listener = plan.listener === "CEO" ? undefined : requireActive(plan.listener);
    ensureMemoryBackfill();

    // Rank stored institutional knowledge by relevance to the CEO question (+ follow-up)
    const allKnowledge = await db
      .select()
      .from(knowledgeEntries)
      .orderBy(desc(knowledgeEntries.id))
      .limit(40);
    const questionTerms = `${session.ceoQuestion} ${plan.ceoFollowUp || ""}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    const relevantKnowledge = allKnowledge
      .map((entry) => {
        const hay = `${entry.topic} ${entry.insight} ${(entry.tags || []).join(" ")}`.toLowerCase();
        const overlap = questionTerms.reduce((acc, t) => (hay.includes(t) ? acc + 2 : acc), 0);
        return { entry, score: overlap + (entry.sessionId === sessionId ? 1 : 0) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((i) => i.entry);

    // Retrieve Plane A (ACL-scoped governed Enterprise KB + KG) strictly separate from Plane B (Agent Memory)
    const [personaCtx, speakerMemories, enterpriseHit] = await Promise.all([
      getPersonaContext(),
      getExecutiveRecall(plan.speaker, session.id),
      retrieveEnterpriseKnowledge({
        query: `${session.ceoQuestion} ${plan.ceoFollowUp || ""}`.trim(),
        principal: makeRolePrincipal(plan.speaker),
        topK: 3,
        includePendingReview: false, // only human-approved enterprise knowledge grounds bots
        includeGraph: true,
        graphHops: 2,
        synthesizeAnswer: false,
      }),
    ]);

    const ekLines = [
      ...enterpriseHit.passages.map(
        (p) =>
          `[Doc #${p.documentId} | ${p.domainKey} | ${p.classificationLevel}] ${p.documentTitle}: ${p.content.slice(0, 220)}`,
      ),
      ...enterpriseHit.knowledgeGraph.triples
        .slice(0, 4)
        .map(
          (t) =>
            `[KG ${t.isCrossDomain ? "cross-domain" : t.edgeDomain}] ${t.subject} --${t.predicate}--> ${t.object}`,
        ),
    ];

    const generated = await generateExecutiveDeliberationTurn({
      sessionId: session.id,
      speaker,
      listener,
      ceoQuestion: session.ceoQuestion,
      plan,
      priorMessages,
      relevantKnowledge,
      config,
      personaBrief: personaCtx.brief,
      personaStyleHint: personaCtx.styleHint,
      speakerMemories,
      enterpriseKnowledgeBrief: ekLines.join("\n"),
    });

    const cycleCompleted = plan.interactionMode === "executive_consensus";
    const { savedMessage, savedKnowledge, updatedSession } = db.transaction(
      (tx) => {
        // The preview and provider response are speculative until this write lock.
        const current = requireActive(plan.speaker, tx);
        if (plan.listener !== "CEO") requireActive(plan.listener, tx);
        const latest = tx
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(eq(conversationMessages.sessionId, sessionId))
          .orderBy(desc(conversationMessages.id))
          .limit(1)
          .get();
        if (!latest || latest.id !== priorMessages.at(-1)?.id)
          throw new RosterError("The conversation changed. Retry against the latest turn.", 409);
        if (current.preset !== speaker.preset)
          throw new RosterError("Speaker permissions changed. Retry the turn.", 409);
        if (relevantKnowledge.length > 0) {
          tx.update(knowledgeEntries)
            .set({ appliedCount: sql`${knowledgeEntries.appliedCount} + 1` })
            .where(
              inArray(
                knowledgeEntries.id,
                relevantKnowledge.slice(0, 2).map((k) => k.id),
              ),
            )
            .run();
        }

        const savedMessage = tx
          .insert(conversationMessages)
          .values({
            sessionId: session.id,
            senderRole: plan.speaker,
            targetRole: plan.listener,
            interactionMode: plan.interactionMode,
            roomZone: plan.roomZone,
            content: generated.dialogue,
            modelUsed: generated.modelUsed,
            providerMode: generated.providerMode,
          })
          .returning()
          .get();

        const savedKnowledge = tx
          .insert(knowledgeEntries)
          .values({
            sessionId: session.id,
            sourceMessageId: savedMessage.id,
            contributorRole:
              plan.interactionMode === "executive_consensus" ? "JOINT" : plan.speaker,
            collaboratorRole: plan.listener,
            topic: generated.knowledgeTopic,
            insight: generated.knowledgeInsight,
            category: generated.knowledgeCategory,
            confidenceScore: generated.confidenceScore,
            tags: generated.tags,
            appliedCount: 0,
          })
          .returning()
          .get();

        // Every executive remembers what was said, heard, observed and learned
        persistMemoriesFor(
          {
            message: savedMessage,
            knowledge: savedKnowledge,
            session: { id: session.id, ceoQuestion: session.ceoQuestion },
          },
          tx,
        );

        const totalBotTurns = priorMessages.filter((m) => m.senderRole !== "CEO").length + 1;
        const updatedSession = tx
          .update(deliberationSessions)
          .set({
            turnCount: totalBotTurns,
            status: cycleCompleted ? "completed" : "deliberating",
            executiveSummary: cycleCompleted ? generated.dialogue : session.executiveSummary,
            updatedAt: new Date(),
          })
          .where(eq(deliberationSessions.id, session.id))
          .returning()
          .get();

        return { savedMessage, savedKnowledge, updatedSession };
      },
      { behavior: "immediate" },
    );
    const nextPlan = planDeliberationStep(
      getRoster(),
      [...priorMessages, savedMessage],
      config.walkTalkRounds,
      session.ceoQuestion,
    );

    after(() =>
      runMemorySync({
        sessionId: session.id,
        personaTrigger: cycleCompleted
          ? "consensus"
          : plan.interactionMode === "ceo_response"
            ? "ceo_response"
            : null,
      }),
    );

    return NextResponse.json({
      message: savedMessage,
      knowledgeEntry: savedKnowledge,
      session: updatedSession,
      roster: getRoster(),
      currentPlan: plan,
      nextPlan,
      cycleCompleted,
      recalledKnowledgeCount: relevantKnowledge.length,
      recalledMemoryCount: speakerMemories.length,
    });
  } catch (error) {
    if (error instanceof RosterError) {
      // Don't pause a newer CEO retarget or another successfully committed reply.
      if (snapshot)
        db.update(deliberationSessions)
          .set({ status: "paused", updatedAt: new Date() })
          .where(
            and(
              eq(deliberationSessions.id, snapshot.sessionId),
              sql`coalesce((select max(id) from conversation_messages where session_id=${snapshot.sessionId}),0)=${snapshot.lastMessageId}`,
            ),
          )
          .run();
      return NextResponse.json(
        { error: error.message, paused: true, roster: getRoster() },
        { status: error.status },
      );
    }
    console.error("Error executing deliberation step:", error);
    return NextResponse.json(
      { error: "Failed to run executive deliberation step" },
      { status: 500 },
    );
  }
}
