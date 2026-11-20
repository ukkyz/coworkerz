import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  conversationMessages,
  deliberationSessions,
  ekDocuments,
  ekEntities,
  ekRelationships,
  knowledgeEntries,
} from "@/db/schema";
import { getActiveOpencodeConfig, publicOpencodeConfig } from "@/lib/opencode-config";
import { asc, desc, eq } from "drizzle-orm";
import { planDeliberationStep } from "@/lib/turn-planner";
import { getRoster } from "@/lib/executive-profile-store";
import { requireCeoConsole } from '../executive-profiles/access';

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req); if (denied) return denied;
    const requestedSessionId = req.nextUrl.searchParams.get("sessionId");
    const sessions = await db
      .select()
      .from(deliberationSessions)
      .orderBy(desc(deliberationSessions.id))
      .limit(30);

    const activeSession = requestedSessionId
      ? db.select().from(deliberationSessions).where(eq(deliberationSessions.id,Number(requestedSessionId))).get()
      : sessions[0] || null;

    if (requestedSessionId && !activeSession) return NextResponse.json({error:"Session not found"},{status:404});
    const messages = activeSession
      ? await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.sessionId, activeSession.id))
          .orderBy(asc(conversationMessages.id))
      : [];

    const knowledge = await db
      .select()
      .from(knowledgeEntries)
      .orderBy(desc(knowledgeEntries.id))
      .limit(100);

    const config = await getActiveOpencodeConfig();
    const roster = getRoster();
    const nextPlan = activeSession ? planDeliberationStep(roster, messages, config.walkTalkRounds, activeSession.ceoQuestion) : null;

    const [ekDocs, ekEnts, ekRels] = await Promise.all([
      db
        .select({ id: ekDocuments.id, reviewStatus: ekDocuments.reviewStatus })
        .from(ekDocuments),
      db.select({ id: ekEntities.id }).from(ekEntities),
      db
        .select({
          id: ekRelationships.id,
          isCrossDomain: ekRelationships.isCrossDomain,
        })
        .from(ekRelationships),
    ]);

    const totalApplications = knowledge.reduce(
      (acc, item) => acc + (item.appliedCount || 0),
      0
    );

    return NextResponse.json({
      enterpriseStats: {
        totalDocs: ekDocs.length,
        approvedDocs: ekDocs.filter((d) => d.reviewStatus === "approved").length,
        pendingReview: ekDocs.filter((d) => d.reviewStatus === "pending_review")
          .length,
        entities: ekEnts.length,
        relationships: ekRels.length,
        crossDomainEdges: ekRels.filter((r) => r.isCrossDomain).length,
      },
      sessions,
      activeSession,
      messages,
      knowledge,
      nextPlan, roster,
      config: publicOpencodeConfig(config),
      stats: {
        totalSessions: sessions.length,
        totalKnowledgeEntries: knowledge.length,
        totalAppliedInsights: totalApplications,
        activeTurnCount: messages.length,
      },
    });
  } catch (error) {
    console.error("Failed to fetch boardroom state:", error);
    return NextResponse.json(
      { error: "Failed to load boardroom state from SQLite" },
      { status: 500 }
    );
  }
}
