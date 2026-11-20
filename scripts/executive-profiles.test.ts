import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {profileOf} from "../src/lib/roster";
import { NextRequest } from "next/server";
import { DEFAULT_PROFILES, type BotProfile } from "../src/lib/executive-profiles";

const maya: BotProfile = {
  displayName: "Maya Santoso", job: "Pilot Funding Adviser",
  skillPrompt: "Identify the budget cap and propose one measurable release gate.",
};

test("executive profiles on an existing SQLite suite", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coworkerz-profiles-"));
  process.env.DATABASE_URL = join(dir, "suite.sqlite");
  const { db, schema: s } = await import("@/db");
  try {
    // Reproduce a populated pre-feature installation using only its actual migration.
    const old = join(dir, "old");
    mkdirSync(join(old, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.slice(0, 1);
    writeFileSync(join(old, "meta/_journal.json"), JSON.stringify(journal));
    const initial = "0000_initial_sqlite.sql";
    copyFileSync(join("drizzle", initial), join(old, initial));
    migrate(db, { migrationsFolder: old });
    const session = db.insert(s.deliberationSessions).values({ ceoQuestion: "Synthetic pilot?" }).returning().get();
    const message = db.insert(s.conversationMessages).values({ sessionId: session.id, senderRole: "CFO", targetRole: "CEO", content: "A historical reply." }).returning().get();
    const config = db.insert(s.opencodeConfigs).values({ baseUrl: "https://synthetic.invalid/v1" }).returning().get();
    migrate(db, { migrationsFolder: "drizzle" }); // no seed/backfill required

    const { GET } = await import("@/app/api/executive-profiles/route");
    const { PUT } = await import("@/app/api/executive-profiles/[role]/route");
    const url = "http://boardroom.test/api/executive-profiles";
    const read = async () => (await (await GET(new NextRequest(url))).json()).profiles;
    const put = (role: string, body: unknown) => PUT(new NextRequest(`${url}/${role}`, {
      method: "PUT", body: JSON.stringify(body),
    }), { params: Promise.resolve({ role }) });

    await t.test("migration leaves rows intact, no overrides or seed required", async () => {
      assert.deepEqual(await read(), DEFAULT_PROFILES);
      assert.deepEqual(db.select().from(s.conversationMessages).get(), message);
      assert.deepEqual(db.select().from(s.deliberationSessions).get(), session);
      assert.deepEqual(db.select().from(s.opencodeConfigs).get(), config);
      assert.deepEqual(db.select().from(s.executiveProfileOverrides).all(), []);
    });

    await t.test("trimmed, role-scoped writes; duplicate names are not IDs", async () => {
      assert.equal((await put("CFO", { ...maya, displayName: ` ${maya.displayName} ` })).status, 200);
      assert.deepEqual(await read(), { ...DEFAULT_PROFILES, CFO: maya });
      const { requireActive } = await import("@/lib/executive-profile-store");
      for (const role of ["CTO", "COO"] as const) {
        const changed = { displayName: maya.displayName, job: `${role} pilot owner`, skillPrompt: `Propose one ${role} checkpoint.` };
        assert.equal((await put(role, changed)).status, 200);
        const saved = await read();
        assert.deepEqual(saved.CFO, maya);
        assert.deepEqual(saved[role], changed);
        assert.deepEqual(profileOf(requireActive(role)), changed);
        assert.equal((await put(role, DEFAULT_PROFILES[role])).status, 200);
      }
      assert.equal(db.select().from(s.executiveRoster).all().length, 3);
    });

    await t.test("reject invalid roles, bodies, field lengths and non-CEO principals without writes", async () => {
      for (const role of ["CEO", "Maya Santoso", "constructor", "cfo"]) assert.equal((await put(role, maya)).status, 404);
      for (const bad of [null, {}, [], { ...maya, role: "CTO" }, { ...maya, job: "  " }, { ...maya, job: 3 },
        { ...maya, displayName: "a".repeat(81) }, { ...maya, job: "b".repeat(121) },
        { ...maya, skillPrompt: "c".repeat(2001) }, { ...maya, displayName: "two\nlines" }, { ...maya, skillPrompt: null }]) {
        assert.equal((await put("CFO", bad)).status, 400);
      }
      const context = { params: Promise.resolve({ role: "CFO" }) };
      assert.equal((await PUT(new NextRequest(`${url}/CFO`, { method: "PUT", body: "{" }), context)).status, 400);
      assert.equal((await PUT(new NextRequest(`${url}/CFO?asRole=CTO`, { method: "PUT", body: JSON.stringify(maya) }), context)).status, 403);
      assert.equal((await GET(new NextRequest(url, { headers: { "x-api-key": "invalid-fixture" } }))).status, 401);
      assert.deepEqual(await read(), { ...DEFAULT_PROFILES, CFO: maya });
    });

    await t.test("local synthesis addresses the renamed peer without pretending to interpret skill text", async () => {
      const { getRoster, requireActive } = await import("@/lib/executive-profile-store");
      const {planDeliberationStep} = await import("@/lib/turn-planner");
      const { generateExecutiveDeliberationTurn } = await import("@/lib/opencode");
      t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
      const plan = planDeliberationStep(getRoster(), [], 4, "architecture")!;
      const turn = await generateExecutiveDeliberationTurn({
        plan, ceoQuestion: session.ceoQuestion, priorMessages: [], relevantKnowledge: [], config,
        speaker: requireActive(plan.speaker), listener: requireActive(plan.listener),
      });
      assert.equal(turn.providerMode, "opencode-local-runtime");
      assert.match(turn.dialogue, /^Maya Santoso,/);
      assert.deepEqual(db.select().from(s.conversationMessages).get(), message);
    });
  } finally {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
