import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

// Set the environment *before* importing the server connection. Both setup jobs run
// in separate processes, so an accidental in-memory DB cannot make this test pass.
test("SQLite setup and application integration", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coworkerz-db-"));
  Object.assign(process.env, {
    DATABASE_URL: `file:${join(dir, "nested", "suite.sqlite")}`,
    MEMORY_DIR: join(dir, "memory"), KNOWLEDGE_DIR: join(dir, "knowledge"),
    OPENCODE_BASE_URL: "https://synthetic.invalid/v1", OPENCODE_API_KEY: "", OPENAI_API_KEY: "",
  });
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  // Invoke npm through Node when possible (including npm.cmd installations on Windows).
  const npm = process.env.npm_execpath;
  const run = (script: string) => npm
    ? execFileSync(process.execPath, [npm, "run", script], { stdio: "pipe" })
    : execFileSync("npm", ["run", script], { stdio: "pipe" });
  const request = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
    new NextRequest(`http://boardroom.test${path}`, init);

  try {
    run("db:migrate");
    const { db, schema: s } = await import("@/db");
    try {
      await t.test("migrations are journaled; failed seeds roll back both planes", () => {
        const history = () => db.all(sql`select hash from __drizzle_migrations order by created_at`);
        const migrated = history();
        assert.ok(migrated.length > 0);
        run("db:migrate");
        assert.deepEqual(history(), migrated);
        assert.equal(db.$client.pragma("foreign_keys", { simple: true }), 1);
        db.insert(s.ekDomains).values({ key: "technology", name: "Existing", description: "Control" }).run();
        assert.throws(() => run("db:seed")); // a conflicting domain is not overwritten
        assert.equal(db.select().from(s.ekDomains).get()?.name, "Existing");
        for (const table of [s.seedRuns, s.deliberationSessions, s.opencodeConfigs]) {
          assert.equal(db.select().from(table).all().length, 0);
        }
        db.delete(s.ekDomains).where(eq(s.ekDomains.key, "technology")).run();
      });

      run("db:seed");
      const session = db.select().from(s.deliberationSessions).get()!;
      await t.test("the boardroom reads the seeded file; API writes round-trip typed JSON, booleans and dates", async () => {
        const health = await import("@/app/api/health/route");
        assert.deepEqual(await (await health.GET()).json(), { ok: true });
        const boardroom = await import("@/app/api/boardroom/route");
        const res = await boardroom.GET(request("/api/boardroom"));
        assert.equal(res.status, 200);
        const board = await res.json();
        assert.equal(board.sessions.length, 1);
        assert.equal(board.messages.length, 5);
        assert.equal(board.knowledge.length, 4);
        assert.equal(board.activeSession.autoWalkAndTalk, true);
        assert.equal(board.activeSession.createdAt, session.createdAt.toISOString());
        assert.equal(board.config.baseUrl, "https://synthetic.invalid/v1");
        assert.ok(board.enterpriseStats.approvedDocs > 0 && board.enterpriseStats.crossDomainEdges > 0);
        const knowledge = await import("@/app/api/knowledge/route");
        const tags = ["synthetic", "quoted \"value\""];
        const saved = await knowledge.POST(request("/api/knowledge", {
          method: "POST", body: JSON.stringify({ topic: "Test", insight: "Persist this note", tags }),
        }));
        assert.equal(saved.status, 200);
        const { knowledgeEntry } = await saved.json();
        assert.deepEqual(db.select().from(s.knowledgeEntries).where(eq(s.knowledgeEntries.id, knowledgeEntry.id)).get()?.tags, tags);
      });

      await t.test("memory statistics, mirrors and scoped enterprise retrieval use SQLite", async () => {
        const memory = await import("@/lib/memory");
        // Add a fourth executive before the first-ever memory backfill on this legacy transcript.
        const {createExecutive, archiveExecutive} = await import('@/lib/executive-profile-store');
        const late = createExecutive({roleName:'Late Joiner',displayName:'Jo',job:'Pilot editor',skillPrompt:'Check the baseline.',model:'suite-test',preset:'none'});
        await memory.ensureMemoryBackfill();
        assert.equal(db.select().from(s.executiveMemories).where(eq(s.executiveMemories.executiveRole,late.id)).all().length,0);
        archiveExecutive(late.id);
        const stats = await memory.getMemoryStats();
        assert.deepEqual([stats.totalMessages, stats.ceoMessages, stats.botToBot, stats.botToCeo], [5, 1, 3, 1]);
        assert.ok(stats.memoriesByRole.CFO > 0);
        const persona = await memory.getOrCreatePersona();
        assert.ok(persona?.profile?.skills.length);
        assert.equal(readFileSync(join(dir, "memory", "CEO_PERSONA.md"), "utf8"), persona.markdown);
        const ek = await import("@/lib/enterprise-knowledge");
        const principal = ek.makeRolePrincipal("CTO");
        const result = await ek.retrieveEnterpriseKnowledge({
          principal, query: "Frankfurt sovereign cluster", synthesizeAnswer: false, includePendingReview: false,
        });
        assert.ok(result.passages.length > 0);
        for (const p of result.passages) assert.notEqual(p.classificationLevel, "board_restricted");
        const mindmap = await ek.generateEnterpriseMindmap({ principal });
        assert.equal(mindmap.summary.agentMemorySeparation.conversationalMessages, 5);
        assert.equal(readFileSync(join(dir, "knowledge", "taxonomy.skos.yaml"), "utf8"), (await ek.getActiveTaxonomyScheme()).yamlContent);
      });

      await t.test("foreign keys cascade messages, retain long-term memory and reject orphans", async () => {
        const sessions = await import("@/app/api/sessions/route");
        assert.equal((await sessions.DELETE(request(`/api/sessions?id=${session.id}`, { method: "DELETE" }))).status, 200);
        assert.equal(db.select().from(s.conversationMessages).all().length, 0);
        for (const table of [s.knowledgeEntries, s.executiveMemories]) {
          const kept = db.select().from(table).all();
          assert.ok(kept.length > 0);
          assert.ok(kept.every(r => r.sessionId === null && r.sourceMessageId === null));
        }
        assert.throws(() => db.insert(s.conversationMessages).values({ sessionId: session.id, senderRole: "CTO", content: "Orphan" }).run());
        assert.deepEqual(db.$client.pragma("foreign_key_check"), []);
      });

      await t.test("rerunning setup preserves user edits and never resurrects deleted demo rows", () => {
        const time = new Date("2026-01-02T03:04:05.678Z");
        db.update(s.opencodeConfigs).set({ walkTalkRounds: 6, updatedAt: time }).run();
        const counts = () => [s.ekDocuments, s.ekChunks, s.ekEntities, s.ekRelationships, s.knowledgeEntries, s.seedRuns]
          .map(table => db.select({ n: sql<number>`count(*)` }).from(table).get()?.n);
        const before = counts();
        run("db:setup");
        assert.deepEqual(counts(), before);
        assert.equal(db.select().from(s.deliberationSessions).all().length, 0);
        const config = db.select().from(s.opencodeConfigs).get()!;
        assert.equal(config.walkTalkRounds, 6);
        assert.equal(config.updatedAt.getTime(), time.getTime());
      });
    } finally {
      db.$client.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
