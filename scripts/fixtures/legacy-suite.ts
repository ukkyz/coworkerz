import { randomBytes, createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { AppDatabase } from "@/db";
import * as s from "@/db/schema";
import { seedEnterprise } from "../seed/enterprise";
import { priorCfo, marker, oldReply } from "./roster-cases";

/** Build a real two-migration installation first; no post-upgrade seed. */
export function populateLegacySuite(db: AppDatabase, dir: string) {
  const old = join(dir, "pre-roster");
  mkdirSync(join(old, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.slice(0, 2);
  for (const { tag } of journal.entries)
    copyFileSync(`drizzle/${tag}.sql`, join(old, `${tag}.sql`));
  writeFileSync(join(old, "meta/_journal.json"), JSON.stringify(journal));
  migrate(db, { migrationsFolder: old });
  const key = randomBytes(20).toString("hex");
  return db.transaction((tx) => {
    seedEnterprise(tx);
    tx.insert(s.executiveProfileOverrides)
      .values({ role: "CFO", ...priorCfo })
      .run();
    tx.insert(s.opencodeConfigs)
      .values({
        baseUrl: "https://profile-test.invalid/v1",
        cfoModel: "opencode/original-finance-free",
        temperature: "0.42",
      })
      .run();
    const session = tx
      .insert(s.deliberationSessions)
      .values({ ceoQuestion: "Can we pilot the changes?", status: "deliberating", turnCount: 1 })
      .returning()
      .get();
    tx.insert(s.conversationMessages)
      .values({
        sessionId: session.id,
        senderRole: "CEO",
        targetRole: "ALL",
        content: session.ceoQuestion,
        interactionMode: "ceo_directive",
      })
      .run();
    const reply = tx
      .insert(s.conversationMessages)
      .values({
        sessionId: session.id,
        senderRole: "CFO",
        targetRole: "CEO",
        content: oldReply,
        modelUsed: "opencode/original-finance-free",
      })
      .returning()
      .get();
    tx.insert(s.executiveMemories)
      .values({ executiveRole: "CFO", sessionId: null, memoryType: "learned", content: marker })
      .run();
    const doc = tx
      .insert(s.ekDocuments)
      .values({
        slug: "synthetic-private-finance",
        title: "Finance only: private ledger",
        domainKey: "finance",
        summary: "Synthetic",
        content: "Ledger evidence.",
        aclReadRoles: ["CFO"],
        classificationLevel: "internal",
        reviewStatus: "approved",
      })
      .returning()
      .get();
    tx.insert(s.ekChunks)
      .values({ documentId: doc.id, domainKey: doc.domainKey, chunkIndex: 0, content: doc.content })
      .run();
    const entity = tx
      .insert(s.ekEntities)
      .values({
        canonicalKey: "synthetic-ledger",
        name: "Private ledger node",
        domainKey: "finance",
        description: "Synthetic",
        aclReadRoles: ["CFO"],
        classificationLevel: "internal",
      })
      .returning()
      .get();
    tx.insert(s.ekApiKeys)
      .values({
        name: "Old finance reader",
        keyPrefix: "fixture",
        keyHash: createHash("sha256").update(key).digest("hex"),
        assignedRole: "CFO",
        allowedDomains: ["finance"],
        clearanceLevel: "internal",
      })
      .run();
    return { key, session, reply, doc, entity };
  });
}
