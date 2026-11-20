import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureTestAuth, sessionHeaders } from "./test-session";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import { CEO_TOPICS, type CeoRadar } from "@/lib/ceo-topics";
import { analyzeTopicSignals } from "@/lib/persona-topic-signals";

const request = (body?: unknown, headers?: Record<string, string>) =>
  new NextRequest("http://suite.test/api/ceo-baseline", {
    method: body === undefined ? "GET" : "POST",
    body: JSON.stringify(body),
    headers: sessionHeaders(headers ?? {}),
  });

test("topic rules keep all eight persona axes distinct, cap repeated mentions, and don't score silence", () => {
  const samples = ["cloud", "budget", "rollout", "merger", "gtm", "churn", "risk", "pricing"];
  assert.equal(CEO_TOPICS.length, 8);
  assert.deepEqual(
    samples.map((s) => analyzeTopicSignals([s]).map((r) => [r.id, r.score])),
    CEO_TOPICS.map((t) => [[t.id, 51]]),
  );
  assert.equal(analyzeTopicSignals(["budget ".repeat(20)])[0].score, 98);
  assert.deepEqual(analyzeTopicSignals(["hello"]), []);
});

test("CEO-only conversation baseline on a migrated SQLite file", async (t) => {
  configureTestAuth();
  const dir = mkdtempSync(join(tmpdir(), "coworkerz-radar-"));
  Object.assign(process.env, {
    ...{},
    DATABASE_URL: join(dir, "suite.sqlite"),
    OPENCODE_OFFLINE: "1",
    MEMORY_DIR: join(dir, "memory"),
    KNOWLEDGE_DIR: join(dir, "knowledge"),
  });
  const egress = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected egress");
  });
  const { db, schema: s } = await import("@/db");
  try {
    migrate(db, { migrationsFolder: "drizzle" });
    const { GET, POST } = await import("@/app/api/ceo-baseline/route");
    const view = async (): Promise<CeoRadar> => (await GET(request())).json();
    const post = (revision: number) => POST(request({ expectedRevision: revision }));
    const session = db
      .insert(s.deliberationSessions)
      .values({ ceoQuestion: "Synthetic" })
      .returning()
      .get();
    const message = (senderRole: string, content: string) =>
      db
        .insert(s.conversationMessages)
        .values({ sessionId: session.id, senderRole, content })
        .run();

    await t.test(
      "no synthetic zeros or writes on read; previews use only CEO messages before a persona exists",
      async () => {
        assert.deepEqual(await view(), {
          readings: {},
          ceoMessages: 0,
          personaVersion: null,
          capturedAt: null,
          revision: 0,
        });
        message("CTO", "cloud platform pricing");
        assert.equal((await post(0)).status, 422);
        message("CEO", "budget budget SYNTHETIC_EXCERPT_ONLY");
        const preview = await view();
        assert.deepEqual(preview.readings, { finance: { score: 57, signals: 2 } });
        assert.equal(preview.ceoMessages, 1);
        assert.equal(preview.revision, 0);
        assert.equal(db.select().from(s.ceoSignalBaseline).all().length, 0);
        assert.equal(db.select().from(s.ceoPersona).all().length, 0);
        assert.doesNotMatch(JSON.stringify(preview), /EXCERPT|lastEvidence/);
      },
    );

    await t.test(
      "neither enterprise keys nor simulated roles can read or capture; client scores are rejected",
      async () => {
        const key = randomBytes(20).toString("hex");
        db.insert(s.ekApiKeys)
          .values({
            name: "Synthetic",
            keyPrefix: "fixture",
            keyHash: createHash("sha256").update(key).digest("hex"),
            assignedRole: "CEO",
            canReadAgentMemory: true,
          })
          .run();
        for (const [headers, status] of [
          [{ "x-simulate-role": "CFO" }, 403],
          [{ "x-api-key": key }, 403],
          [{ "x-api-key": "invalid" }, 401],
        ] as const) {
          assert.equal((await GET(request(undefined, headers))).status, status);
          assert.equal((await POST(request({ expectedRevision: 0 }, headers))).status, status);
        }
        for (const bad of [
          null,
          {},
          { expectedRevision: -1 },
          { expectedRevision: "0" },
          { expectedRevision: 0, readings: {} },
        ]) {
          assert.equal((await POST(request(bad))).status, 400);
        }
        assert.equal(db.select().from(s.ceoSignalBaseline).all().length, 0);
      },
    );

    await t.test(
      "capture is frozen across new messages and persona rebuild; explicit replacement uses the saved persona",
      async () => {
        const response = await post(0);
        assert.equal(response.status, 201);
        const first = (await response.json()) as CeoRadar;
        assert.equal(first.revision, 1);
        assert.ok(first.capturedAt && Number.isFinite(Date.parse(first.capturedAt)));
        assert.deepEqual(first.readings, { finance: { score: 57, signals: 2 } });
        message("CEO", "pricing");
        db.insert(s.opencodeConfigs).values({}).run();
        const { updatePersona } = await import("@/lib/memory");
        const persona = await updatePersona("manual_rebuild");
        assert.ok(persona?.profile);
        assert.equal(
          persona.profile.skills.find((s) => s.name === CEO_TOPICS[1].name)?.score,
          first.readings.finance?.score,
        );
        assert.deepEqual(await view(), first);
        assert.equal((await post(0)).status, 409);
        // Not analyzed by the stored persona yet: the snapshot must identify its actual source.
        message("CEO", "governance");
        const replaced = await post(1);
        assert.equal(replaced.status, 200);
        const second = (await replaced.json()) as CeoRadar;
        assert.equal(second.personaVersion, persona.version);
        assert.equal(second.ceoMessages, 2);
        assert.equal(second.revision, 2);
        assert.deepEqual(second.readings, {
          finance: { score: 57, signals: 2 },
          product: { score: 51, signals: 1 },
        });
        assert.deepEqual(await view(), second);
        assert.equal(db.select().from(s.ceoSignalBaseline).all().length, 1);
        assert.doesNotMatch(JSON.stringify(second), /EXCERPT|lastEvidence|executiveObservations/);
      },
    );
    assert.equal(egress.mock.callCount(), 0);
  } finally {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
