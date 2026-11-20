import { NextRequest, NextResponse } from "next/server";
import { getMember } from "@/lib/executive-profile-store";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { executiveMemories } from "@/db/schema";
import { resolvePrincipal } from "@/lib/enterprise-knowledge";
import {
  ensureMemoryBackfill,
  getMemoryStats,
  getOrCreatePersona,
} from "@/lib/memory";

export const dynamic = "force-dynamic";

const HEADERS = {
  "X-Knowledge-Plane": "conversational_agent_memory",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, X-Simulate-Role",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}

/**
 * Strictly separate REST service for Conversational Agent Memory (identity-owned episodic
 * memories + CEO_PERSONA.md). API keys scoped solely to Enterprise Knowledge receive 403.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await resolvePrincipal(req);
    if (auth.error) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401, headers: HEADERS }
      );
    }

    if (!auth.principal.canReadAgentMemory) {
      return NextResponse.json(
        {
          plane: "conversational_agent_memory",
          enterpriseKnowledgeIsolated: true,
          error: `Plane isolation enforced: principal "${auth.principal.role}" is authorized for Enterprise Knowledge only and cannot read Conversational Agent Memory (canReadAgentMemory=false).`,
        },
        { status: 403, headers: HEADERS }
      );
    }

    await ensureMemoryBackfill();
    const filter = req.nextUrl.searchParams.get("executive")?.trim();
    const member = filter ? getMember(filter.startsWith('exec-') ? filter : filter.toUpperCase()) : undefined;
    if (req.nextUrl.searchParams.has('executive') && !member) return NextResponse.json({error: "Unknown executive identity."}, {status: 404, headers: HEADERS});
    const limit = Math.min(
      50,
      Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 15))
    );

    const [persona, stats, mems] = await Promise.all([
      getOrCreatePersona(),
      getMemoryStats(),
      member
        ? db
            .select()
            .from(executiveMemories)
            .where(eq(executiveMemories.executiveRole, member.id))
            .orderBy(desc(executiveMemories.id))
            .limit(limit)
        : db
            .select()
            .from(executiveMemories)
            .orderBy(desc(executiveMemories.id))
            .limit(limit),
    ]);

    return NextResponse.json(
      {
        plane: "conversational_agent_memory",
        enterpriseKnowledgeIsolated: true,
        principal: {
          role: auth.principal.role,
          authType: auth.principal.authType,
        },
        ceoPersona: persona
          ? {
              version: persona.version,
              summary: persona.profile?.executiveSummary || "",
              styleHint: persona.profile?.styleHint || "",
              topSkills: (persona.profile?.skills || []).slice(0, 5),
              updatedAt: persona.updatedAt,
            }
          : null,
        stats,
        episodicMemories: mems,
      },
      { headers: HEADERS }
    );
  } catch (error) {
    console.error("GET /api/v1/agent-memory failed:", error);
    return NextResponse.json(
      { error: "Failed to query Agent Memory service" },
      { status: 500, headers: HEADERS }
    );
  }
}
