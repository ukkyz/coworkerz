import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/db";
import { conversationMessages, deliberationSessions } from "@/db/schema";
import { getActiveOpencodeConfig } from "@/lib/opencode-config";
import { planDeliberationStep } from "@/lib/opencode";
import { persistMemoriesFor, runMemorySync } from "@/lib/memory";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const VALID_TARGETS = new Set(["ALL", "CTO", "CFO", "COO"]);

/** CEO follow-up inside an existing session — addressed to the whole C-suite or one executive. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      sessionId?: number;
      content?: string;
      targetRole?: string;
    };
    const sessionId = Number(body.sessionId);
    const content = body.content?.trim() || "";
    const targetRole = (body.targetRole || "ALL").toUpperCase();

    if (!sessionId || content.length < 2 || !VALID_TARGETS.has(targetRole)) {
      return NextResponse.json(
        { error: "sessionId, content and a valid targetRole (ALL, CTO, CFO, COO) are required" },
        { status: 400 }
      );
    }

    const [session] = await db
      .select()
      .from(deliberationSessions)
      .where(eq(deliberationSessions.id, sessionId))
      .limit(1);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const [message] = await db
      .insert(conversationMessages)
      .values({
        sessionId,
        senderRole: "CEO",
        targetRole,
        interactionMode: "ceo_followup",
        roomZone: "ceo-briefing",
        content,
        modelUsed: "ceo-command",
        providerMode: "human-ceo",
      })
      .returning();

    const [updatedSession] = await db
      .update(deliberationSessions)
      .set({ status: "deliberating", updatedAt: new Date() })
      .where(eq(deliberationSessions.id, sessionId))
      .returning();

    await persistMemoriesFor({
      message,
      knowledge: null,
      session: { id: session.id, ceoQuestion: session.ceoQuestion },
    });

    const config = await getActiveOpencodeConfig();
    const nextPlan = planDeliberationStep(0, config.walkTalkRounds, {
      content,
      targetRole,
      interactionMode: "ceo_followup",
    });

    after(() => runMemorySync({ sessionId, personaTrigger: "ceo_followup" }));

    return NextResponse.json({ message, session: updatedSession, nextPlan });
  } catch (error) {
    console.error("Failed to save CEO follow-up:", error);
    return NextResponse.json({ error: "Failed to save CEO message" }, { status: 500 });
  }
}
