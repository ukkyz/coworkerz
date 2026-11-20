import { asc, eq } from "drizzle-orm";
import { db, type AppDatabase } from "@/db";
import { ceoPersona, ceoSignalBaseline, conversationMessages } from "@/db/schema";
import { CEO_TOPICS, type CeoRadar, type TopicReadings } from "./ceo-topics";
import { analyzeTopicSignals } from "./persona-topic-signals";

type Source = Pick<CeoRadar, "personaVersion" | "ceoMessages" | "readings">;

function readSource(tx: AppDatabase): Source {
  const row = tx
    .select({
      profile: ceoPersona.profile,
      version: ceoPersona.version,
      ceoMessages: ceoPersona.analyzedMessageCount,
    })
    .from(ceoPersona)
    .orderBy(asc(ceoPersona.id))
    .limit(1)
    .get();
  const readings: TopicReadings = {};
  if (Array.isArray(row?.profile?.skills)) {
    for (const { id, name } of CEO_TOPICS) {
      const skill = row.profile.skills.find((s) => s?.name === name);
      if (
        skill &&
        Number.isInteger(skill.score) &&
        skill.score >= 0 &&
        skill.score <= 100 &&
        Number.isSafeInteger(skill.evidenceCount) &&
        skill.evidenceCount > 0
      ) {
        readings[id] = { score: skill.score, signals: skill.evidenceCount };
      }
    }
    return { readings, personaVersion: row.version, ceoMessages: row.ceoMessages };
  }

  // A fresh installation may have messages but no materialized persona. Don't call
  // getOrCreatePersona(): previewing this chart must not rebuild memory or contact a model.
  const messages = tx
    .select({ text: conversationMessages.content })
    .from(conversationMessages)
    .where(eq(conversationMessages.senderRole, "CEO"))
    .all();
  for (const { id, score, hits } of analyzeTopicSignals(messages.map((m) => m.text))) {
    readings[id] = { score, signals: hits };
  }
  return { readings, personaVersion: null, ceoMessages: messages.length };
}

function present(row: typeof ceoSignalBaseline.$inferSelect): CeoRadar {
  const { capturedAt, revision, personaVersion, ceoMessages, readings } = row;
  return { capturedAt: capturedAt.toISOString(), revision, personaVersion, ceoMessages, readings };
}

export function readCeoRadar(): CeoRadar {
  const saved = db.select().from(ceoSignalBaseline).get();
  return saved ? present(saved) : { ...readSource(db), revision: 0, capturedAt: null };
}

export class BaselineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Server-derived capture. A stale tab cannot overwrite a more recent CEO decision. */
export function captureCeoBaseline(expectedRevision: number): CeoRadar {
  return db.transaction(
    (tx) => {
      const saved = tx
        .select({ revision: ceoSignalBaseline.revision })
        .from(ceoSignalBaseline)
        .get();
      if ((saved?.revision ?? 0) !== expectedRevision) {
        throw new BaselineError("The saved baseline changed. Refresh before capturing again.", 409);
      }
      const source = readSource(tx);
      if (!Object.keys(source.readings).length) {
        throw new BaselineError(
          "No topic signals to capture yet. Discuss a topic in the boardroom, then refresh.",
          422,
        );
      }
      const values = { ...source, revision: expectedRevision + 1, capturedAt: new Date() };
      const row = tx
        .insert(ceoSignalBaseline)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: ceoSignalBaseline.id, set: values })
        .returning()
        .get();
      return present(row);
    },
    { behavior: "immediate" },
  );
}
