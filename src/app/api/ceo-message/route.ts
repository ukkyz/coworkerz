import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/db";
import { conversationMessages, deliberationSessions } from "@/db/schema";
import { getActiveOpencodeConfig } from "@/lib/opencode-config";
import { planDeliberationStep } from "@/lib/turn-planner";
import { getRoster, resolveTarget, RosterError } from "@/lib/executive-profile-store";
import { requireCeoConsole } from "../executive-profiles/access";
import { ensureMemoryBackfill, persistMemoriesFor, runMemorySync } from "@/lib/memory";
import { asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** CEO follow-up inside an existing session — addressed to the whole C-suite or one executive. */
export async function POST(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req);
    if (denied) return denied;
    const body = (await req.json()) as {
      sessionId?: number;
      content?: string;
      targetRole?: string;
    };
    const sessionId = Number(body.sessionId);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!sessionId || content.length < 2) {
      return NextResponse.json(
        {
          error:
            "sessionId, content and a valid targetRole (ALL or an active executive ID) are required",
        },
        { status: 400 },
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

    ensureMemoryBackfill();
    const { message, updatedSession } = db.transaction(
      (tx) => {
        const targetRole = resolveTarget(body.targetRole, tx);
        const message = tx
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
          .returning()
          .get();

        const updatedSession = tx
          .update(deliberationSessions)
          .set({ status: "deliberating", updatedAt: new Date() })
          .where(eq(deliberationSessions.id, sessionId))
          .returning()
          .get();

        persistMemoriesFor(
          {
            message,
            knowledge: null,
            session: { id: session.id, ceoQuestion: session.ceoQuestion },
          },
          tx,
        );

        return { message, updatedSession };
      },
      { behavior: "immediate" },
    );
    const config = await getActiveOpencodeConfig();
    const history = db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.sessionId, sessionId))
      .orderBy(asc(conversationMessages.id))
      .all();
    const nextPlan = planDeliberationStep(
      getRoster(),
      history,
      config.walkTalkRounds,
      session.ceoQuestion,
    );

    after(() => runMemorySync({ sessionId, personaTrigger: "ceo_followup" }));

    return NextResponse.json({ message, session: updatedSession, nextPlan });
  } catch (error) {
    if (error instanceof RosterError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to save CEO follow-up:", error);
    return NextResponse.json({ error: "Failed to save CEO message" }, { status: 500 });
  }
}
