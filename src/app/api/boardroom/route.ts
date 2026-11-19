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
import { getActiveOpencodeConfig } from "@/lib/opencode-config";
import { asc, desc, eq } from "drizzle-orm";
import {
  deriveDeliberationContext,
  planDeliberationStep,
} from "@/lib/opencode";

export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (!key || key.trim().length === 0) return "";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  try {
    const requestedSessionId = req.nextUrl.searchParams.get("sessionId");
    const sessions = await db
      .select()
      .from(deliberationSessions)
      .orderBy(desc(deliberationSessions.id))
      .limit(30);

    const activeSession = requestedSessionId
      ? sessions.find((s) => s.id === Number(requestedSessionId)) || sessions[0]
      : sessions[0] || null;

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
    const envHasApiKey = Boolean(
      process.env.OPENCODE_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim()
    );

    const deliberationCtx = deriveDeliberationContext(messages);
    const nextPlan = activeSession
      ? planDeliberationStep(
          deliberationCtx.turnsSinceLastCeo,
          config.walkTalkRounds,
          deliberationCtx.lastCeo
        )
      : null;

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
      nextPlan,
      config: {
        id: config.id,
        baseUrl: config.baseUrl,
        hasApiKey: Boolean(config.apiKey?.trim()) || envHasApiKey,
        maskedApiKey: maskKey(config.apiKey),
        envHasApiKey,
        ctoModel: config.ctoModel,
        cfoModel: config.cfoModel,
        cooModel: config.cooModel,
        temperature: config.temperature,
        walkTalkRounds: config.walkTalkRounds,
      },
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
