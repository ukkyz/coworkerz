import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureTestAuth, sessionHeaders } from "./test-session";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import { CONSOLE_BASE, GO_BASE, OPENAI_BASE, gatewayBase } from "@/lib/gateway-endpoints";
import { readHeaderRules } from "@/lib/gateway-headers";

const custom = "https://gateway.example/v1";
const rules = (base: string) =>
  JSON.stringify({
    [base]: [
      { name: "X-Client-Tag", type: "static", value: "cw-suite", prefix: "cw-" },
      { name: "X-Request-ID", type: "sequence", prefix: "req_" },
      { name: "X-Audit-ID", type: "sequence", prefix: "audit-" },
    ],
  });
const api = (method: string, body?: unknown, path = "/api/opencode-config") =>
  new NextRequest(`http://suite.test${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: sessionHeaders({ "Content-Type": "application/json" }),
  });

test("header rules match an exact normalized base and enforce literal prefixes and safe fields", () => {
  assert.equal(gatewayBase(" https://GATEWAY.example:443/v1/// "), custom);
  assert.equal(readHeaderRules(rules(custom + "/"), custom).length, 3);
  for (const other of [custom + "/other", "https://other.example/v1"])
    assert.deepEqual(readHeaderRules(rules(custom), other), []);
  for (const bad of [
    "*",
    "https://*.example/v1",
    "http://gateway.example/v1",
    "https://user:pass@gateway.example/v1",
    custom + "?key=hidden",
    custom + "#fragment",
    custom + "/chat/completions",
  ]) {
    assert.throws(() => gatewayBase(bad));
  }
  const fixed = { name: "X-Tag", type: "static", value: "ok" };
  const badRules = [
    [{ ...fixed, prefix: "team-" }],
    [{ ...fixed, value: "a\r\nb" }],
    [{ ...fixed, value: " \t" }],
    [{ ...fixed, name: "Bad Name" }],
    [fixed, { ...fixed, name: "x-TAG" }],
    [{ name: "X-Request-ID", type: "sequence", prefix: "req_\n" }],
    [{ ...fixed, type: "sequence" }],
    [{ ...fixed, type: "template" }],
    [{ ...fixed, unexpected: true }],
    ...[
      "Authorization",
      "uSeR-aGeNt",
      "x-opencode-session",
      "Host",
      "Content-Length",
      "Cookie",
      "Proxy-Authorization",
    ].map((name) => [{ ...fixed, name }]),
  ];
  for (const list of badRules)
    assert.throws(() => readHeaderRules(JSON.stringify({ [custom]: list }), custom));
  assert.throws(() => readHeaderRules("not JSON", custom));
  assert.throws(() =>
    readHeaderRules(JSON.stringify({ [custom]: [], [custom + "/"]: [] }), custom),
  );
});

test("live gateway transport, CEO settings and diagnostics", async (t) => {
  configureTestAuth();
  const dir = mkdtempSync(join(tmpdir(), "coworkerz-gateway-"));
  const workspaceKey = randomUUID(),
    openAIKey = randomUUID();
  Object.assign(process.env, {
    ...{},
    DATABASE_URL: join(dir, "suite.sqlite"),
    MEMORY_DIR: join(dir, "memory"),
    KNOWLEDGE_DIR: join(dir, "knowledge"),
    OPENCODE_OFFLINE: "0",
    OPENCODE_BASE_URL: CONSOLE_BASE,
    OPENCODE_API_KEY: "",
    OPENAI_API_KEY: openAIKey,
    OPENCODE_HEADER_RULES: rules(GO_BASE),
    CW_SECRET_KEY: "test-master-key-for-the-gateway-suite-0001",
  });
  const { db, schema: s } = await import("@/db");
  // Only this loopback receiver sees real HTTP. All public-provider traffic is intercepted before dispatch.
  type WireBody = {
    model: string;
    messages: { role: string; content: string }[];
    max_tokens: number;
    temperature?: number;
  };
  const traffic: { method?: string; path: string; headers: IncomingHttpHeaders; body: WireBody }[] =
    [];
  const receiver = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    traffic.push({ method: req.method, path: req.url!, headers: req.headers, body });
    if (req.url?.startsWith("/redirect/")) {
      res.writeHead(307, { Location: "/elsewhere/chat/completions" }).end();
      return;
    }
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(
        JSON.stringify({ choices: [{ message: { content: "Synthetic completion received." } }] }),
      );
  });
  try {
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
    const base = origin + "/proxy/v1";
    migrate(db, { migrationsFolder: "drizzle" });
    // A stored credential is sealed at rest; the transport unseals it before egress.
    const { seal } = await import("@/lib/secret-box");
    const config = db
      .insert(s.opencodeConfigs)
      .values({ baseUrl: GO_BASE, apiKey: seal(workspaceKey).sealed })
      .returning()
      .get();
    const { POST, GET, PUT } = await import("@/app/api/opencode-config/route");
    const { storedKey } = await import("@/lib/model-gateway");
    const { tryLiveOpencodeCompletion: live } = await import("@/lib/opencode");
    const complete = (sessionId: number) =>
      live({
        config,
        sessionId,
        modelDisplayId: "opencode-go/kimi-k3",
        systemPrompt: "Synthetic test",
        userPrompt: "Return the fixture.",
      });
    const probe = async (body: object = {}) => (await POST(api("POST", body))).json();
    const calls: { url: string; headers: Headers; model: string }[] = [];
    let reply = () =>
      Response.json({ choices: [{ message: { content: "Synthetic completion received." } }] });
    const nativeFetch = globalThis.fetch;
    const fetch = t.mock.method(
      globalThis,
      "fetch",
      async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).origin === origin) return nativeFetch(input, init);
        assert.ok(
          [GO_BASE, CONSOLE_BASE, OPENAI_BASE].some((b) => request.url === `${b}/chat/completions`),
          "unapproved test destination",
        );
        calls.push({
          url: request.url,
          headers: request.headers,
          model: (await request.json()).model,
        });
        return reply();
      },
    );

    await t.test(
      "both plans use their selected path, actual app identity and conversation-scoped session IDs",
      async () => {
        await complete(1);
        await complete(1);
        await complete(2);
        assert.equal(calls.length, 3);
        const ids = calls.map((c) => c.headers.get("x-opencode-session"));
        for (const [i, c] of calls.entries()) {
          assert.equal(c.url, `${GO_BASE}/chat/completions`);
          assert.equal(c.model, "kimi-k3");
          assert.equal(c.headers.get("authorization"), `Bearer ${workspaceKey}`);
          assert.equal(c.headers.get("user-agent"), "coworkerz/1.0");
          assert.match(ids[i]!, /^ses_[0-9a-f]{32}$/);
          assert.equal(c.headers.get("x-audit-id"), `audit-${i + 1}`);
          assert.equal(c.headers.get("x-request-id"), `req_${i + 1}`);
          assert.equal(c.headers.get("x-client-tag"), "cw-suite");
        }
        assert.equal(ids[0], ids[1]);
        assert.notEqual(ids[0], ids[2]);
        assert.equal((await probe({ testModel: "opencode-go/kimi-k3" })).reachable, true);
        assert.equal(calls[3].headers.get("x-request-id"), "req_4");
        assert.notEqual(calls[3].headers.get("x-opencode-session"), ids[0]);
        assert.equal((await probe({ baseUrl: CONSOLE_BASE })).reachable, false); // neither the other saved key nor OPENAI_API_KEY
        assert.equal(calls.length, 4);
        process.env.OPENCODE_API_KEY = workspaceKey;
        assert.equal(
          (await probe({ baseUrl: CONSOLE_BASE, testModel: "opencode/kimi-k3" })).reachable,
          true,
        );
        assert.equal(calls[4].url, `${CONSOLE_BASE}/chat/completions`);
        assert.equal(calls[4].model, "kimi-k3");
        assert.equal(calls[4].headers.get("x-client-tag"), null);
        assert.equal(calls[4].headers.get("authorization"), `Bearer ${workspaceKey}`);
        assert.equal(
          (await probe({ baseUrl: OPENAI_BASE, testModel: "vendor/model" })).reachable,
          true,
        );
        assert.equal(calls[5].headers.get("authorization"), `Bearer ${openAIKey}`);
        assert.equal(calls[5].headers.get("x-opencode-session"), null);
        assert.equal(calls[5].model, "vendor/model");
      },
    );

    await t.test(
      "a fresh process on the same SQLite file resumes numbering and the same conversation",
      () => {
        const child = `global.fetch = async (_url, {headers}) => { console.log(JSON.stringify([headers.get('x-opencode-session'), headers.get('x-request-id')])); return Response.json({choices:[{message:{content:'Synthetic reply received.'}}]}); }; require('./src/lib/opencode.ts').tryLiveOpencodeCompletion({config: {baseUrl: '${GO_BASE}',apiKey: '',temperature: '0.65'},sessionId:1,modelDisplayId:'kimi-k3',systemPrompt:'Test',userPrompt:'Test'}).then(x=>{if(!x)process.exitCode=1;});`;
        const output = execFileSync(process.execPath, ["--import", "tsx", "-e", child], {
          encoding: "utf8",
          env: process.env,
        });
        assert.deepEqual(JSON.parse(output), [calls[0].headers.get("x-opencode-session"), "req_5"]);
      },
    );

    await t.test(
      "offline, invalid rules and missing keys are no-egress; provider denials never change billing paths",
      async () => {
        const n = fetch.mock.callCount();
        process.env.OPENCODE_OFFLINE = "1";
        assert.equal(await complete(1), null);
        assert.match((await probe()).message, /disabled/);
        process.env.OPENCODE_OFFLINE = "0";
        const secret = randomUUID();
        process.env.OPENCODE_HEADER_RULES = JSON.stringify({
          [GO_BASE]: [{ name: "x-app", type: "static", prefix: "cw-", value: secret }],
        });
        const invalid = await probe();
        assert.match(invalid.message, /prefix/);
        assert.ok(!JSON.stringify(invalid).includes(secret));
        assert.equal(await complete(1), null);
        assert.equal(fetch.mock.callCount(), n);
        process.env.OPENCODE_HEADER_RULES = rules(GO_BASE);
        for (const status of [401, 403, 429]) {
          reply = () => new Response(secret, { status });
          const before = fetch.mock.callCount();
          const denied = await probe();
          assert.equal(denied.reachable, false);
          assert.equal(denied.httpStatus, status);
          assert.ok(!JSON.stringify(denied).includes(secret));
          assert.equal(await complete(1), null);
          assert.equal(fetch.mock.callCount(), before + 2);
          assert.ok(calls.slice(-2).every((c) => c.url === `${GO_BASE}/chat/completions`));
        }
        assert.equal(calls[n].headers.get("x-request-id"), "req_6");
        reply = () => {
          throw new Error(secret);
        };
        const network = await probe();
        assert.equal(network.reachable, false);
        assert.ok(!JSON.stringify(network).includes(secret));
        reply = () => Response.json({ choices: [{ message: { content: "  " } }] });
        assert.equal((await probe()).reachable, false);
        reply = () => new Response("Not a chat completion", { status: 200 });
        assert.equal((await probe()).reachable, false);
        assert.equal(
          (await POST(api("POST", { headers: { "X-Not-Allowed": "client value" } }))).status,
          400,
        );
        assert.equal((await POST(api("POST", {}, "/api/opencode-config?asRole=CTO"))).status, 403);
      },
    );

    await t.test(
      "custom headers reach an actual HTTP server, are base-specific, and do not follow redirects",
      async () => {
        const privateTag = randomUUID();
        const rulesForBase = JSON.parse(rules(base));
        rulesForBase[base].push({ name: "X-Proxy-Token", type: "static", value: privateTag });
        process.env.OPENCODE_HEADER_RULES = JSON.stringify(rulesForBase);
        assert.equal(
          (await probe({ baseUrl: base + "/", testModel: "vendor/model" })).reachable,
          true,
        );
        const sent = traffic.at(-1)!;
        assert.equal(sent.path, "/proxy/v1/chat/completions");
        assert.equal(sent.method, "POST");
        assert.equal(sent.headers["content-type"], "application/json");
        assert.deepEqual(sent.body, {
          model: "vendor/model",
          max_tokens: 64,
          messages: [{ role: "user", content: "Reply OK from the Coworkerz gateway diagnostic." }],
        });
        assert.equal(sent.headers.authorization, undefined);
        assert.equal(sent.headers["user-agent"], "coworkerz/1.0");
        assert.equal(sent.headers["x-proxy-token"], privateTag);
        assert.equal(sent.headers["x-request-id"], "req_1");
        const parallel = Array.from({ length: 6 }, () =>
          live({
            config: { ...config, baseUrl: base, apiKey: "" },
            modelDisplayId: "vendor/model",
            sessionId: 3,
            systemPrompt: "Synthetic",
            userPrompt: "Return the fixture.",
          }),
        );
        assert.ok(
          (await Promise.all(parallel)).every((text) => text === "Synthetic completion received."),
        );
        assert.deepEqual(
          traffic
            .slice(1)
            .map((r) => r.headers["x-request-id"])
            .sort(),
          ["req_2", "req_3", "req_4", "req_5", "req_6", "req_7"],
        );
        assert.deepEqual(traffic[1].body, {
          model: "vendor/model",
          messages: [
            { role: "system", content: "Synthetic" },
            { role: "user", content: "Return the fixture." },
          ],
          temperature: 0.65,
          max_tokens: 550,
        });
        process.env.OPENCODE_BASE_URL = base; // explicit operator pin for the env key
        assert.equal((await probe({ baseUrl: base })).reachable, true);
        assert.equal(traffic.at(-1)!.headers.authorization, `Bearer ${workspaceKey}`);
        const before = traffic.length;
        const redirect = await probe({ baseUrl: origin + "/redirect" });
        assert.equal(redirect.httpStatus, 307);
        assert.equal(traffic.length, before + 1);
        assert.equal(traffic.at(-1)!.headers["x-proxy-token"], undefined);
        assert.equal(traffic.at(-1)!.headers.authorization, undefined);
        const saved = await PUT(api("PUT", { baseUrl: base }));
        assert.equal(saved.status, 200);
        assert.equal(storedKey(db.select().from(s.opencodeConfigs).get()!.apiKey), ""); // URL change did not move the stored credential
        const publicSettings = await (await GET(api("GET"))).json();
        assert.equal(publicSettings.config.baseUrl, base);
        assert.equal(publicSettings.config.envHasApiKey, true);
        for (const sensitive of [
          workspaceKey,
          privateTag,
          "X-Proxy-Token",
          "OPENCODE_HEADER_RULES",
        ])
          assert.ok(!JSON.stringify(publicSettings).includes(sensitive));
        assert.equal((await PUT(api("PUT", { baseUrl: base + "?token=unsafe" }))).status, 400);
        assert.equal(db.select().from(s.opencodeConfigs).get()!.baseUrl, base);
      },
    );

    await t.test(
      "key replacement, retention and clearing never echo a key or an unsafe legacy URL",
      async () => {
        const savedKey = randomUUID(),
          draftKey = randomUUID();
        const settings = await (
          await PUT(api("PUT", { baseUrl: base + "/", apiKey: savedKey }))
        ).json();
        assert.equal(settings.config.maskedApiKey, "••••");
        assert.ok(!JSON.stringify(settings).includes(savedKey));
        await PUT(api("PUT", { baseUrl: base }));
        assert.equal(storedKey(db.select().from(s.opencodeConfigs).get()!.apiKey), savedKey);
        await probe({ apiKey: draftKey });
        assert.equal(traffic.at(-1)!.headers.authorization, `Bearer ${draftKey}`);
        await probe();
        assert.equal(traffic.at(-1)!.headers.authorization, `Bearer ${savedKey}`);
        await probe({ clearApiKey: true });
        assert.equal(traffic.at(-1)!.headers.authorization, `Bearer ${workspaceKey}`);
        await PUT(api("PUT", { clearApiKey: true }));
        assert.equal(storedKey(db.select().from(s.opencodeConfigs).get()!.apiKey), "");

        db.update(s.opencodeConfigs)
          .set({ baseUrl: `${base}?token=${draftKey}`, apiKey: seal(savedKey).sealed })
          .run(); // legacy row, before URL validation
        const board = await import("@/app/api/boardroom/route");
        for (const response of [
          await GET(api("GET")),
          await board.GET(api("GET", undefined, "/api/boardroom")),
        ]) {
          const json = await response.json();
          assert.equal(json.config.baseUrl, "");
          assert.ok(!JSON.stringify(json).includes(draftKey));
          assert.ok(!JSON.stringify(json).includes(savedKey));
        }
        const before = fetch.mock.callCount();
        assert.equal((await probe()).reachable, false);
        assert.equal(fetch.mock.callCount(), before);
        await PUT(api("PUT", { baseUrl: base }));
        assert.equal(storedKey(db.select().from(s.opencodeConfigs).get()!.apiKey), "");
      },
    );
  } finally {
    receiver.closeAllConnections();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
