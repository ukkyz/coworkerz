import { requireCeoConsole } from "@/app/api/executive-profiles/access";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { personaRevisions } from "@/db/schema";
import { desc } from "drizzle-orm";
import {
  ensureMemoryBackfill,
  getMemoryStats,
  getOrCreatePersona,
  listMemoryFiles,
  rebuildAllMemory,
} from "@/lib/memory";

export const dynamic = "force-dynamic";

async function buildMemoryPayload() {
  await ensureMemoryBackfill();
  const persona = await getOrCreatePersona();
  const [revisions, stats, files] = await Promise.all([
    db
      .select({
        id: personaRevisions.id,
        version: personaRevisions.version,
        changeSummary: personaRevisions.changeSummary,
        triggerEvent: personaRevisions.triggerEvent,
        sessionId: personaRevisions.sessionId,
        createdAt: personaRevisions.createdAt,
      })
      .from(personaRevisions)
      .orderBy(desc(personaRevisions.id))
      .limit(15),
    getMemoryStats(),
    listMemoryFiles(),
  ]);

  return {
    persona: persona
      ? {
          version: persona.version,
          markdown: persona.markdown,
          profile: persona.profile,
          providerMode: persona.providerMode,
          updatedAt: persona.updatedAt,
        }
      : null,
    revisions,
    stats,
    files,
    memoryDir: "memory/",
  };
}

export async function GET(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req); if (denied) return denied;
    return NextResponse.json(await buildMemoryPayload());
  } catch (error) {
    console.error("Failed to load memory:", error);
    return NextResponse.json({ error: "Failed to load executive memory" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req); if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "rebuild") {
      await rebuildAllMemory();
    }
    return NextResponse.json(await buildMemoryPayload());
  } catch (error) {
    console.error("Failed to rebuild memory:", error);
    return NextResponse.json({ error: "Failed to rebuild memory" }, { status: 500 });
  }
}
