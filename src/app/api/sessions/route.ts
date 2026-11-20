import { NextRequest, NextResponse, after } from "next/server";
import { ensureMemoryBackfill, persistMemoriesFor, runMemorySync } from "@/lib/memory";
import { db } from "@/db";
import { conversationMessages, deliberationSessions } from "@/db/schema";
import { getActiveOpencodeConfig } from "@/lib/opencode-config";
import { planDeliberationStep } from "@/lib/turn-planner";
import { getRoster, resolveTarget, RosterError } from "@/lib/executive-profile-store";
import { requireCeoConsole } from "../executive-profiles/access";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req);
    if (denied) return denied;
    const body = (await req.json()) as {
      ceoQuestion?: string;
      autoWalkAndTalk?: boolean;
      targetRole?: string;
    };

    const ceoQuestion = typeof body.ceoQuestion === "string" ? body.ceoQuestion.trim() : "";
    if (!ceoQuestion || ceoQuestion.length < 4) {
      return NextResponse.json(
        { error: "Please enter a strategic question for your C-suite team." },
        { status: 400 },
      );
    }

    const autoWalkAndTalk = body.autoWalkAndTalk ?? true;
    const config = await getActiveOpencodeConfig();

    ensureMemoryBackfill();
    const { session, ceoMessage } = db.transaction(
      (tx) => {
        const targetRole = resolveTarget(body.targetRole, tx);
        const session = tx
          .insert(deliberationSessions)
          .values({
            ceoQuestion,
            status: "deliberating",
            autoWalkAndTalk,
            turnCount: 0,
          })
          .returning()
          .get();

        const ceoMessage = tx
          .insert(conversationMessages)
          .values({
            sessionId: session.id,
            senderRole: "CEO",
            targetRole,
            interactionMode: "ceo_directive",
            roomZone: "ceo-briefing",
            content: ceoQuestion,
            modelUsed: "ceo-command",
            providerMode: "human-ceo",
          })
          .returning()
          .get();

        // Every executive memorizes the CEO directive; persona + markdown files update in background
        persistMemoriesFor(
          {
            message: ceoMessage,
            knowledge: null,
            session: { id: session.id, ceoQuestion: session.ceoQuestion },
          },
          tx,
        );
        return { session, ceoMessage };
      },
      { behavior: "immediate" },
    );
    after(() => runMemorySync({ sessionId: session.id, personaTrigger: "ceo_directive" }));

    const firstStepPlan = planDeliberationStep(
      getRoster(),
      [ceoMessage],
      config.walkTalkRounds,
      ceoQuestion,
    );

    return NextResponse.json({
      session,
      ceoMessage,
      firstStepPlan,
      plannedRounds: config.walkTalkRounds,
    });
  } catch (error) {
    if (error instanceof RosterError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to create CEO session:", error);
    return NextResponse.json({ error: "Failed to save CEO question in database" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req);
    if (denied) return denied;
    const idParam = req.nextUrl.searchParams.get("id");
    const id = Number(idParam);
    if (!id) {
      return NextResponse.json({ error: "Valid session id is required" }, { status: 400 });
    }

    await db.delete(deliberationSessions).where(eq(deliberationSessions.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete session:", error);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
