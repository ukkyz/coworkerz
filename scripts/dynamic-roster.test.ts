import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import { populateLegacySuite } from "./fixtures/legacy-suite";
import { priorCfo, productHead, pilotLead, marker } from "./fixtures/roster-cases";
import { isActive, profileOf } from "../src/lib/roster";
import { planDeliberationStep } from "../src/lib/turn-planner";

const req = (path: string, method = "GET", data?: object, headers?: Record<string, string>) =>
  new NextRequest(`http://suite.test${path}`, {
    method,
    body: data && JSON.stringify(data),
    headers,
  });

test("live roster on a populated, migrated SQLite file", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coworkerz-roster-"));
  Object.assign(process.env, {
    DATABASE_URL: join(dir, "suite.sqlite"),
    MEMORY_DIR: join(dir, "memory"),
    KNOWLEDGE_DIR: join(dir, "knowledge"),
    OPENCODE_API_KEY: "",
    OPENAI_API_KEY: "",
  });
  const { db, schema: s } = await import("@/db");
  try {
    assert.equal(db.$client.name, join(dir, "suite.sqlite"), "Fixture may write only to the disposable database");
    const old = populateLegacySuite(db, dir);
    migrate(db, { migrationsFolder: "drizzle" });
    const { getRoster, requireActive, createExecutive, archiveExecutive, saveExecutiveProfile } =
      await import("@/lib/executive-profile-store");
    const {
      resolvePrincipal,
      canPrincipalRead,
      makeRolePrincipal,
      createEnterpriseApiKey,
      retrieveEnterpriseKnowledge,
      queryKnowledgeGraph,
    } = await import("@/lib/enterprise-knowledge");
    const { getExecutiveRecall, getMemoryFileContent, ensureMemoryBackfill } =
      await import("@/lib/memory");
    const { POST: step } = await import("@/app/api/deliberate/step/route");
    const { POST: send } = await import("@/app/api/ceo-message/route");
    const { PUT: config } = await import("@/app/api/opencode-config/route");
    const { GET: memory } = await import("@/app/api/v1/agent-memory/route");
    const history = () =>
      db
        .select()
        .from(s.conversationMessages)
        .where(eq(s.conversationMessages.sessionId, old.session.id))
        .all();
    const oldKey = () =>
      resolvePrincipal(
        req("/api/v1/enterprise/documents", "GET", undefined, { "x-api-key": old.key }),
      );
    const newPlan = () => planDeliberationStep(getRoster(), history(), 4, old.session.ceoQuestion);
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));

    await t.test(
      "forward migration preserves identity, overrides, assignments, historical owners and a domain-scoped key",
      async () => {
        assert.deepEqual(
          getRoster().map((e) => e.id),
          ["CTO", "CFO", "COO"],
        );
        assert.deepEqual(profileOf(requireActive("CFO")), priorCfo);
        assert.equal(requireActive("CFO").model, "opencode/original-finance-free");
        assert.deepEqual(history().at(-1), old.reply);
        assert.match((await getExecutiveRecall("CFO", old.session.id)).join(), new RegExp(marker));
        const { principal, error } = await oldKey();
        assert.equal(error, undefined);
        assert.deepEqual(principal.allowedDomains, ["finance"]);
        assert.equal(principal.clearance, "internal");
        assert.equal(canPrincipalRead(principal, old.doc), true);
        assert.equal(canPrincipalRead(principal, old.entity), true);
        assert.equal(canPrincipalRead(principal, { ...old.doc, domainKey: "technology" }), false);
      },
    );
    const lead = createExecutive(pilotLead);
    await t.test("distinct IDs, explicit presets, duplicate rollback and fair ties", async () => {
      assert.equal(getRoster().filter(isActive).length, 4);
      assert.deepEqual(await getExecutiveRecall(lead.id, old.session.id), []);
      assert.throws(
        () => createExecutive({ ...pilotLead, roleName: "  pILOT Readiness Lead  " }, "CFO"),
        /already has/,
      );
      assert.equal(requireActive("CFO").preset, "legacy");
      assert.throws(
        () => createExecutive({ ...pilotLead, roleName: "New", preset: undefined }),
        /select a permission/,
      );
      assert.throws(
        () => createExecutive({ ...pilotLead, roleName: "New", preset: "legacy" }),
        /select a permission/,
      );
      assert.throws(
        () => saveExecutiveProfile(lead.id, { ...pilotLead, roleName: "Alias" }),
        /Invalid/,
      );
      assert.equal(
        planDeliberationStep(getRoster(), [], 4, "dress rehearsal checklists")?.speaker,
        lead.id,
      );
      const tie = [
        { senderRole: "CTO", targetRole: "CEO", interactionMode: "ceo_response", content: "done" },
      ];
      assert.equal(planDeliberationStep(getRoster(), tie, 4, "quux")?.speaker, "CFO");
      assert.equal(planDeliberationStep(getRoster(), [], 4, "quux")?.speaker, "CTO");
    });
    const product = createExecutive(productHead, "CFO");
    await t.test(
      "archive remains CEO-readable. Old addresses & keys fail closed; same title can be reused",
      async () => {
        assert.notEqual(product.id, "CFO");
        assert.throws(() => requireActive("CFO"), /left the roster/);
        assert.match((await getMemoryFileContent("executives/CFO.md"))!, new RegExp(marker));
        assert.ok(!(await getMemoryFileContent(`executives/${product.id}.md`))!.includes(marker));
        assert.equal(await getMemoryFileContent("executives/../../etc/passwd"), null);
        assert.deepEqual(await getExecutiveRecall(product.id, old.session.id), []);
        assert.ok((await oldKey()).error);
        assert.deepEqual(history().at(-1), old.reply);
        assert.equal(canPrincipalRead(makeRolePrincipal(product.id), old.doc), false);
        assert.equal(canPrincipalRead(makeRolePrincipal(product.id), old.entity), false);
        for (const bad of ["CFO", "not-a-principal"]) {
          assert.ok((await resolvePrincipal(req(`/?asRole=${bad}`))).error);
          const response = await send(
            req("/api/ceo-message", "POST", {
              sessionId: old.session.id,
              content: "Who can answer?",
              targetRole: bad,
            }),
          );
          assert.ok([404, 409].includes(response.status));
        }
        const retrieve = await import("@/app/api/v1/enterprise/retrieve/route");
        assert.equal(
          (await retrieve.POST(req("/retrieve", "POST", { query: "ledger", asRole: "CFO" })))
            .status,
          401,
        );
        const reused = createExecutive({ ...pilotLead, roleName: " CFO " });
        assert.notEqual(reused.id, "CFO");
        assert.equal(
          (await config(req("/api/opencode-config", "PUT", { cfoModel: "stale" }))).status,
          409,
        );
        assert.equal(requireActive(reused.id).model, pilotLead.model);
        archiveExecutive(reused.id);
        const { GET: file } = await import("@/app/api/memory/file/route");
        assert.equal(
          (await file(req(`/api/memory/file?path=executives/CFO.md&asRole=${product.id}`))).status,
          403,
        );
        assert.equal(
          (await memory(req("/api/v1/agent-memory?executive=no-such-owner"))).status,
          404,
        );
      },
    );

    await t.test(
      "reader clearance ∩ item ACL ∩ key scope for documents, graph endpoints & edges; no writes/private reads",
      async () => {
        function point(name: string, classificationLevel: string, aclReadRoles: string[]) {
          const common = { domainKey: "operations", classificationLevel, aclReadRoles };
          const d = db
            .insert(s.ekDocuments)
            .values({
              ...common,
              slug: name,
              title: name,
              content: `synthetic rehearsal ${name}`,
              summary: "Synthetic",
              reviewStatus: "approved",
            })
            .returning()
            .get();
          db.insert(s.ekChunks)
            .values({ documentId: d.id, domainKey: d.domainKey, chunkIndex: 0, content: d.content })
            .run();
          const e = db
            .insert(s.ekEntities)
            .values({ ...common, canonicalKey: name, name, description: name })
            .returning()
            .get();
          return { d, e };
        }
        const allow = point("rehearsal-open", "internal", [lead.id, product.id]);
        const restricted = point("rehearsal-restricted", "confidential", ["*"]);
        const denied = point("rehearsal-unlisted", "internal", ["CFO"]);
        const edge = (target: number, roles: string[]) =>
          db
            .insert(s.ekRelationships)
            .values({
              sourceEntityId: allow.e.id,
              targetEntityId: target,
              predicate: "CHECKS",
              domainKey: "operations",
              classificationLevel: "internal",
              aclReadRoles: roles,
            })
            .returning()
            .get();
        const visibleEdge = edge(restricted.e.id, ["*"]),
          wrongEndpoint = edge(denied.e.id, ["*"]),
          wrongAcl = edge(restricted.e.id, ["CFO"]);
        for (const e of [lead, product]) {
          const principal = makeRolePrincipal(e.id);
          const found = await retrieveEnterpriseKnowledge({
            principal,
            query: "synthetic rehearsal",
            topK: 12,
            synthesizeAnswer: false,
            includeSeparateAgentMemory: true,
          });
          const ids = found.passages.map((p) => p.documentId);
          assert.ok(ids.includes(allow.d.id));
          assert.equal(ids.includes(restricted.d.id), e.id === product.id);
          assert.ok(!ids.includes(denied.d.id));
          const graph = await queryKnowledgeGraph({ principal });
          const nodes = graph.entities.map((n) => n.id),
            edges = graph.relationships.map((r) => r.id);
          assert.ok(nodes.includes(allow.e.id));
          assert.equal(nodes.includes(restricted.e.id), e.id === product.id);
          assert.ok(!nodes.includes(denied.e.id));
          assert.equal(edges.includes(visibleEdge.id), e.id === product.id);
          assert.ok(!edges.includes(wrongAcl.id) && !edges.includes(wrongEndpoint.id));
          assert.equal(principal.canWrite, false);
          assert.equal(principal.canReadAgentMemory, false);
          const { POST } = await import("@/app/api/v1/enterprise/graph/route");
          assert.equal((await POST(req(`/graph?asRole=${e.id}`, "POST", {}))).status, 403);
          assert.equal((await memory(req(`/api/v1/agent-memory?asRole=${e.id}`))).status, 403);
        }
        await assert.rejects(
          createEnterpriseApiKey({ name: "overgrant", assignedRole: lead.id, canWrite: true }),
        );
        const key = await createEnterpriseApiKey({
          name: "scope test",
          assignedRole: product.id,
          allowedDomains: ["finance"],
        });
        const keyAuth = () =>
          resolvePrincipal(
            req("/?asRole=CEO", "GET", undefined, { "x-api-key": key.plainTextKey }),
          );
        assert.equal(canPrincipalRead((await keyAuth()).principal, allow.d), false);
        const emptyKey = await createEnterpriseApiKey({
          name: "No domains",
          assignedRole: lead.id,
          allowedDomains: [],
        });
        assert.deepEqual(
          (
            await resolvePrincipal(
              req("/", "GET", undefined, { "x-api-key": emptyKey.plainTextKey }),
            )
          ).principal.allowedDomains,
          [],
        );
        saveExecutiveProfile(product.id, { ...profileOf(product), preset: "none" });
        assert.deepEqual((await keyAuth()).principal.allowedDomains, []);
        const taxonomy = await import('@/app/api/v1/enterprise/taxonomy/route');
      assert.equal((await taxonomy.GET(req(`/taxonomy?asRole=${product.id}`))).status,403);
      const none = await queryKnowledgeGraph({ principal: makeRolePrincipal(product.id) });
        assert.equal(none.entities.length + none.relationships.length, 0);
      },
    );

    await t.test(
      "in-flight retirement of listener or speaker discards the entire speculative turn",
      async () => {
        const snapshot = () => [
          history(),
          db.select().from(s.knowledgeEntries).all(),
          db.select().from(s.executiveMemories).all(),
          db.select().from(s.deliberationSessions).get()?.turnCount,
        ];
        for (const side of ["listener", "speaker"] as const) {
          const plan = newPlan()!;
          assert.notEqual(plan[side], "CEO");
          // This latch is inside the transport, after roster selection and recall but before commit.
          let release!: () => void, started!: () => void;
          const barrier = new Promise<void>((r) => {
            release = r;
          });
          const sent = new Promise<void>((r) => {
            started = r;
          });
          const stub = t.mock.method(globalThis, "fetch", async () => {
            started();
            await barrier;
            return Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ dialogue: "This stale result must not commit." }),
                  },
                },
              ],
            });
          });
          const before = snapshot();
          const pending = step(req("/api/deliberate/step", "POST", { sessionId: old.session.id }));
          await sent;
          if (side === "listener") archiveExecutive(plan.listener);
          else createExecutive({ ...pilotLead, roleName: "Fresh chair" }, plan.speaker);
          release();
          const response = await pending;
          stub.mock.restore();
          assert.equal(response.status, 409);
          assert.equal((await response.json()).paused, true);
          assert.deepEqual(snapshot(), before);
          assert.equal(db.select().from(s.deliberationSessions).get()?.status, "paused");
        }
      },
    );
    await t.test(
      "historical backfill observes actual membership, not current owners; no peer & empty pause",
      async () => {
        // A fresh worker may encounter historical messages with no memory rows.
        // Exercise the shared recording path at an old message boundary directly.
        const { persistMemoriesFor } = await import("@/lib/memory");
        ensureMemoryBackfill();
        db.transaction((tx) =>
          persistMemoriesFor({ message: old.reply, session: old.session }, tx),
        );
        assert.ok(
          db
            .select()
            .from(s.executiveMemories)
            .where(eq(s.executiveMemories.sourceMessageId, old.reply.id))
            .all()
            .every((m) => ["CTO", "CFO", "COO"].includes(m.executiveRole)),
        );
        for (const e of getRoster().filter(isActive).slice(1)) archiveExecutive(e.id);
        assert.equal(newPlan()?.listener, "CEO");
        archiveExecutive(getRoster().find(isActive)!.id);
        assert.equal(newPlan(), null);
        assert.equal(
          (await step(req("/api/deliberate/step", "POST", { sessionId: old.session.id }))).status,
          409,
        );
        assert.equal((await getMemoryFileContent("executives/CFO.md"))?.includes(marker), true);
        assert.deepEqual(db.$client.pragma("foreign_key_check"), []);
      },
    );
  } finally {
    db.$client.close();
    rmSync(dir, { force: true, recursive: true });
  }
});
