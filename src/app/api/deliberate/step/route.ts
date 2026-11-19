import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/db";
import {
  conversationMessages,
  deliberationSessions,
  knowledgeEntries,
} from "@/db/schema";
import { getTurnIdentity } from "@/lib/executive-profile-store";
import { getActiveOpencodeConfig } from "@/lib/opencode-config";
import {
  deriveDeliberationContext,
  generateExecutiveDeliberationTurn,
  planDeliberationStep,
} from "@/lib/opencode";
import {
  getExecutiveRecall,
  getPersonaContext,
  persistMemoriesFor,
  runMemorySync,
} from "@/lib/memory";
import {
  makeRolePrincipal,
  retrieveEnterpriseKnowledge,
} from "@/lib/enterprise-knowledge";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
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

    const config = await getActiveOpencodeConfig();
    const { lastCeo, turnsSinceLastCeo } = deriveDeliberationContext(priorMessages);
    const plan = planDeliberationStep(turnsSinceLastCeo, config.walkTalkRounds, lastCeo);

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

    if (relevantKnowledge.length > 0) {
      await db
        .update(knowledgeEntries)
        .set({ appliedCount: sql`${knowledgeEntries.appliedCount} + 1` })
        .where(inArray(knowledgeEntries.id, relevantKnowledge.slice(0, 2).map((k) => k.id)));
    }

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
          `[Doc #${p.documentId} | ${p.domainKey} | ${p.classificationLevel}] ${p.documentTitle}: ${p.content.slice(0, 220)}`
      ),
      ...enterpriseHit.knowledgeGraph.triples
        .slice(0, 4)
        .map(
          (t) =>
            `[KG ${t.isCrossDomain ? "cross-domain" : t.edgeDomain}] ${t.subject} --${t.predicate}--> ${t.object}`
        ),
    ];

    const generated = await generateExecutiveDeliberationTurn({
      ...getTurnIdentity(plan.speaker),
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

    const [savedMessage] = await db
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
      .returning();

    const [savedKnowledge] = await db
      .insert(knowledgeEntries)
      .values({
        sessionId: session.id,
        sourceMessageId: savedMessage.id,
        contributorRole: plan.interactionMode === "executive_consensus" ? "JOINT" : plan.speaker,
        collaboratorRole: plan.listener,
        topic: generated.knowledgeTopic,
        insight: generated.knowledgeInsight,
        category: generated.knowledgeCategory,
        confidenceScore: generated.confidenceScore,
        tags: generated.tags,
        appliedCount: 0,
      })
      .returning();

    // Every executive remembers what was said, heard, observed and learned
    await persistMemoriesFor({
      message: savedMessage,
      knowledge: savedKnowledge,
      session: { id: session.id, ceoQuestion: session.ceoQuestion },
    });

    const cycleCompleted = plan.interactionMode === "executive_consensus";
    const totalBotTurns = priorMessages.filter((m) => m.senderRole !== "CEO").length + 1;
    const [updatedSession] = await db
      .update(deliberationSessions)
      .set({
        turnCount: totalBotTurns,
        status: cycleCompleted ? "completed" : "deliberating",
        executiveSummary: cycleCompleted ? generated.dialogue : session.executiveSummary,
        updatedAt: new Date(),
      })
      .where(eq(deliberationSessions.id, session.id))
      .returning();

    const nextPlan = planDeliberationStep(turnsSinceLastCeo + 1, config.walkTalkRounds, lastCeo);

    after(() =>
      runMemorySync({
        sessionId: session.id,
        personaTrigger: cycleCompleted
          ? "consensus"
          : plan.interactionMode === "ceo_response"
          ? "ceo_response"
          : null,
      })
    );

    return NextResponse.json({
      message: savedMessage,
      knowledgeEntry: savedKnowledge,
      session: updatedSession,
      currentPlan: plan,
      nextPlan,
      cycleCompleted,
      recalledKnowledgeCount: relevantKnowledge.length,
      recalledMemoryCount: speakerMemories.length,
    });
  } catch (error) {
    console.error("Error executing deliberation step:", error);
    return NextResponse.json({ error: "Failed to run executive deliberation step" }, { status: 500 });
  }
}
