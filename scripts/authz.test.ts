import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import {
  API_ROUTE_RULES,
  authMode,
  decideGate,
  signSession,
  SESSION_COOKIE,
  verifySession,
  type SessionClaims,
} from "@/lib/session";
import { eq } from "drizzle-orm";
import { buildRequest, concretePath, context, ORIGIN } from "./test-api";
import {
  configureTestAuth,
  sessionHeaders,
  sessionToken,
  TEST_ACCESS_CODE,
  TEST_SESSION_SECRET,
} from "./test-session";

const ROUTE_FILES = readdirSync("src/app/api", { recursive: true, encoding: "utf8" })
  .filter((entry) => entry.endsWith("route.ts"))
  .map((entry) => "/api/" + entry.replace(/\/route\.ts$/, "").replaceAll("\\", "/"))
  .sort();

/** Import a handler without a compile-time map of every module path. */
async function handler(path: string): Promise<Record<string, unknown>> {
  const specifier = `./../src/app/api${path.replace(/^\/api/, "")}/route.ts`;
  return (await import(specifier)) as Record<string, unknown>;
}

function headersFrom(cookie?: string): Headers {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

test("Phase 0 authorization matrix", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coworkerz-authz-"));
  Object.assign(process.env, {
    DATABASE_URL: join(dir, "suite.sqlite"),
    MEMORY_DIR: join(dir, "memory"),
    KNOWLEDGE_DIR: join(dir, "knowledge"),
    OPENCODE_BASE_URL: "https://synthetic.invalid/v1",
    OPENCODE_API_KEY: "",
    OPENAI_API_KEY: "",
    OPENCODE_OFFLINE: "1",
  });
  configureTestAuth();
  const npm = process.env.npm_execpath;
  const run = (script: string) =>
    npm
      ? execFileSync(process.execPath, [npm, "run", script], { stdio: "pipe" })
      : execFileSync("npm", [script], { stdio: "pipe" });

  try {
    run("db:setup");

    await t.test("every route file has a policy, and every policy has a file", () => {
      const declared = API_ROUTE_RULES.map((rule) => rule.path).sort();
      assert.deepEqual(
        declared,
        ROUTE_FILES,
        "src/lib/session.ts API_ROUTE_RULES must match src/app/api/**/route.ts exactly",
      );
    });

    await t.test("anonymous callers are denied on every handler", async () => {
      const problems: string[] = [];
      for (const rule of API_ROUTE_RULES) {
        if (rule.auth === "public") continue;
        const routeModule = await handler(rule.path);
        for (const method of rule.methods) {
          const fn = routeModule[method] as
            | ((req: Request, ctx: unknown) => Promise<Response>)
            | undefined;
          if (!fn) {
            problems.push(`${method} ${rule.path}: handler missing`);
            continue;
          }
          const response = await fn(
            buildRequest(method, concretePath(rule.path)),
            context({ role: "fixture-id", id: "fixture-id" }),
          );
          if (![401, 403].includes(response.status)) {
            const detail = (await response.text()).slice(0, 120);
            problems.push(`${method} ${rule.path} answered ${response.status} without a session: ${detail}`);
          }
        }
      }
      assert.deepEqual(problems, [], problems.join("\n"));
    });

    await t.test("the anonymous denial carries no data payload", async () => {
      const routeModule = await handler("/api/v1/enterprise/documents");
      const response = await (routeModule.GET as (r: Request) => Promise<Response>)(
        buildRequest("GET", "/api/v1/enterprise/documents"),
      );
      assert.equal(response.status, 401);
      const body = (await response.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body), ["error"]);
      assert.ok(!JSON.stringify(body).toLowerCase().includes("kestrel"));
    });

    await t.test("no default CEO principal is reachable without a verified session", async () => {
      const { resolveApiPrincipal } = await import("@/lib/access");
      const { denyAnonymous } = await import("@/lib/enterprise-knowledge");
      const anonymous = await resolveApiPrincipal(buildRequest("GET", "/api/boardroom"));
      assert.equal(anonymous.error, "Sign in required.");
      assert.equal(anonymous.principal.authType, "anonymous");
      assert.equal(anonymous.principal.authType, denyAnonymous().authType);
      assert.deepEqual(anonymous.principal.allowedDomains, [], "no anonymous enterprise scope");

      // A simulated identity is not a session: the console still refuses it.
      const simulated = await resolveApiPrincipal(
        buildRequest("GET", "/api/boardroom", { query: { asRole: "CTO" } }),
      );
      assert.notEqual(simulated.principal.authType, "ceo-session");

      // Only a valid signed cookie yields the CEO principal.
      const verified = await resolveApiPrincipal(
        buildRequest("GET", "/api/boardroom", { headers: { cookie: sessionHeaders().cookie } }),
      );
      assert.equal(verified.error, undefined);
      assert.equal(verified.principal.authType, "ceo-session");
    });

    await t.test("a forged or expired cookie is rejected", async () => {
      const forged = `${SESSION_COOKIE}=eyJzdWIiOiJDRU8ifQ.deadbeef`;
      assert.equal(await verifySession(forged.split("=")[1], TEST_SESSION_SECRET), null);

      const now = Date.now();
      const expired: SessionClaims = { sub: "CEO", csrf: "x", iat: now - 7200_000, exp: now - 60_000 };
      const staleToken = await signSession(expired, TEST_SESSION_SECRET);
      assert.equal(await verifySession(staleToken, TEST_SESSION_SECRET), null);

      const foreignToken = await signSession(
        { sub: "CEO", csrf: "x", iat: now, exp: now + 60_000 },
        "a-completely-different-secret-that-is-long",
      );
      assert.equal(await verifySession(foreignToken, TEST_SESSION_SECRET), null);
    });

    await t.test("a valid session reaches the console, and a CEO-session key is not implied", async () => {
      const cookie = sessionHeaders().cookie;
      assert.equal(typeof cookie, "string");
      const claims = await verifySession(decodeURIComponent(cookie!.split("=")[1]), TEST_SESSION_SECRET);
      assert.equal(claims?.sub, "CEO");

      const boardroomRoute = await handler("/api/boardroom");
      const res = await (boardroomRoute.GET as (r: Request) => Promise<Response>)(
        buildRequest("GET", "/api/boardroom", {
          headers: { cookie, "sec-fetch-site": "same-origin" },
        }),
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { sessions: unknown[] };
      assert.ok(body.sessions.length >= 1);
    });

    await t.test("an enterprise API key cannot administer the roster", async () => {
      const profilesRoute = await handler("/api/executive-profiles");
      const res = await (profilesRoute.POST as (r: Request, c: unknown) => Promise<Response>)(
        buildRequest("POST", "/api/executive-profiles", { headers: { "x-api-key": "aek_not-a-real-key" } }),
        context(),
      );
      // Present-but-invalid is 401; a valid non-CEO principal is 403. Either way: not 200.
      assert.ok([401, 403].includes(res.status), `got ${res.status}`);
      // Present-but-invalid is specifically 401: the caller never established an identity.
      assert.equal(res.status, 401, "an invalid key must not be resolved to a permission denial");
    });

    await t.test("middleware denies by default, including unknown API paths", async () => {
      assert.equal((await decideGate("/api/boardroom", "GET", new Headers())).allow, false);

      const unknown = await decideGate("/api/users/1", "GET", new Headers());
      assert.equal(unknown.allow, false);
      assert.equal(unknown.allow === false && unknown.status, 404);

      // Presence of a bearer is enough at the edge; the handler still validates the key.
      assert.equal(
        (await decideGate("/api/v1/enterprise/documents", "GET", headersFrom(), )).allow,
        false,
      );
      const bearerHeaders = new Headers({ authorization: "Bearer aek_x" });
      assert.equal((await decideGate("/api/v1/enterprise/documents", "GET", bearerHeaders)).allow, true);

      assert.equal((await decideGate("/api/health", "GET", new Headers())).allow, true);
      assert.equal((await decideGate("/api/auth/sign-in", "POST", new Headers())).allow, true);
    });

    await t.test("a cross-site mutation is refused, a same-origin one is allowed", async () => {
      const cookie = sessionHeaders().cookie!;
      const value = decodeURIComponent(cookie.split("=")[1]);

      const crossSite = await decideGate(
        "/api/knowledge",
        "POST",
        new Headers({ cookie: `${SESSION_COOKIE}=${value}`, "sec-fetch-site": "cross-site" }),
      );
      assert.equal(crossSite.allow, true, "the edge gate allows; CSRF is a handler concern");

      const { csrfProblem } = await import("@/lib/session");
      assert.equal(
        csrfProblem(
          new Headers({ cookie: cookie, "sec-fetch-site": "cross-site", host: "suite.test" }),
          false,
        ) !== null,
        true,
      );
      assert.equal(
        csrfProblem(
          new Headers({ origin: "https://evil.test", host: "suite.test" }),
          false,
        ),
        "Cross-site request refused.",
      );
      assert.equal(
        csrfProblem(new Headers({ origin: ORIGIN, host: "suite.test" }), false),
        null,
      );
      // Bearer callers carry no ambient credential, so CSRF does not apply to them.
      assert.equal(csrfProblem(new Headers({ origin: "https://evil.test" }), true), null);
    });

    await t.test("hostile sign-in attempts fail closed", async () => {
      const signInRoute = await handler("/api/auth/sign-in");
      const post = signInRoute.POST as (r: Request) => Promise<Response>;

      const wrong = await post(
        buildRequest("POST", "/api/auth/sign-in", {
          body: { accessCode: "wrong-code" },
          headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.7" },
        }),
      );
      assert.equal(wrong.status, 401);

      const crossSite = await post(
        buildRequest("POST", "/api/auth/sign-in", {
          body: { accessCode: TEST_ACCESS_CODE },
          headers: { origin: "https://evil.test", host: "suite.test", "x-real-ip": "203.0.113.8" },
        }),
      );
      assert.equal(crossSite.status, 403);

      const good = await post(
        buildRequest("POST", "/api/auth/sign-in", {
          body: { accessCode: TEST_ACCESS_CODE },
          headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.9" },
        }),
      );
      assert.equal(good.status, 200);
      const cookies = good.headers.getSetCookie();
      // NODE_ENV is not "production" here, so the plain name is used (a browser rejects
      // a __Host- cookie that carries no Secure attribute, which http:// cannot accept).
      assert.ok(cookies.some((c) => c.startsWith("cw_session=") && c.includes("HttpOnly")));
      assert.ok(!cookies.some((c) => c.startsWith("__Host-")), "no Secure-less __Host- cookie");
      assert.ok(cookies.some((c) => c.includes("SameSite=Lax")));
      assert.ok(cookies.some((c) => c.startsWith("cw_csrf=")));

      // The budget is per client, so the earlier failures do not lock this address out.
      for (let i = 0; i < 5; i++) {
        await post(
          buildRequest("POST", "/api/auth/sign-in", {
            body: { accessCode: "wrong-code" },
            headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.10" },
          }),
        );
      }
      const throttled = await post(
        buildRequest("POST", "/api/auth/sign-in", {
          body: { accessCode: TEST_ACCESS_CODE },
          headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.10" },
        }),
      );
      assert.equal(throttled.status, 429);
    });

    await t.test("an unconfigured secret is a 503, never an allow", async () => {
      const saved = process.env.CW_SESSION_SECRET;
      delete process.env.CW_SESSION_SECRET;
      try {
        assert.equal(authMode(), "misconfigured");
        const decision = await decideGate("/api/boardroom", "GET", new Headers());
        assert.equal(decision.allow, false);
        assert.equal(decision.allow === false && decision.status, 503);

        const boardroomRoute = await handler("/api/boardroom");
        const res = await (boardroomRoute.GET as (r: Request) => Promise<Response>)(
          buildRequest("GET", "/api/boardroom"),
        );
        assert.equal(res.status, 503);
      } finally {
        process.env.CW_SESSION_SECRET = saved;
      }
    });

    await t.test("the cookie name and Secure flag follow the deployment scheme", async () => {
      const { sessionCookieHeaders } = await import("@/lib/session");
      const prod = sessionCookieHeaders({
        token: "t",
        csrf: "c",
        maxAge: 60,
        env: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
      });
      assert.match(prod[0], /^__Host-cw_session=/);
      assert.match(prod[0], /Secure/);
      assert.match(prod[0], /HttpOnly/);
      assert.match(prod[0], /SameSite=Lax/);
      const dev = sessionCookieHeaders({
        token: "t",
        csrf: "c",
        maxAge: 60,
        env: { NODE_ENV: "development" } as NodeJS.ProcessEnv,
      });
      assert.match(dev[0], /^cw_session=/);
      assert.ok(!dev[0].includes("Secure"), "http:// cannot echo a Secure cookie back");
    });

    await t.test("sign-out clears exactly the cookie sign-in set", async () => {
      const signInRoute = await handler("/api/auth/sign-in");
      const signOutRoute = await handler("/api/auth/sign-out");
      const signedIn = await (signInRoute.POST as (r: Request) => Promise<Response>)(
        buildRequest("POST", "/api/auth/sign-in", {
          body: { accessCode: TEST_ACCESS_CODE },
          headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.20" },
        }),
      );
      const signedOut = await (signOutRoute.POST as (r: Request) => Promise<Response>)(
        buildRequest("POST", "/api/auth/sign-out", {
          body: {},
          headers: { "sec-fetch-site": "same-origin" },
        }),
      );
      const attributes = (cookie: string) =>
        new Set(
          cookie
            .split(";")
            .slice(1)
            .map((part) => part.trim())
            .filter((part) => part && !part.startsWith("Max-Age")),
        );
      for (const set of signedIn.headers.getSetCookie()) {
        const name = set.slice(0, set.indexOf("="));
        const clear = signedOut.headers
          .getSetCookie()
          .find((candidate) => candidate.startsWith(`${name}=`));
        assert.ok(clear, `sign-out does not clear ${name}`);
        // RFC 6265: a deletion only matches when name, path and domain line up.
        assert.ok(clear.startsWith(`${name}=;`), `${name} is not cleared with an empty value`);
        assert.match(clear, /Max-Age=0/);
        const want = attributes(set);
        const got = attributes(clear);
        for (const attribute of want) {
          if (/^Max-Age=/.test(attribute)) continue;
          assert.ok(got.has(attribute), `${name} clear header is missing "${attribute}"`);
        }
      }
    });

    await t.test("CW_AUTH_DISABLED is refused in production", () => {
      const env = (mode: string) =>
        ({
          NODE_ENV: mode,
          CW_AUTH_DISABLED: "1",
          CW_SESSION_SECRET: TEST_SESSION_SECRET,
        }) as NodeJS.ProcessEnv;
      assert.equal(authMode(env("production")), "misconfigured");
      assert.equal(authMode(env("development")), "disabled");
      assert.equal(authMode({ ...env("production"), CW_AUTH_DISABLED: "0" }), "session");
    });

    await t.test("a skill-prompt edit is versioned and requires a reason", async () => {
      const { db, schema: s } = await import("@/db");
      const { eq: drizzleEq } = await import("drizzle-orm");
      const { createExecutive, promptHistory, saveExecutiveProfile } = await import(
        "@/lib/executive-profile-store"
      );
      const created = createExecutive({
        roleName: "Pilot Readiness Lead",
        displayName: "Ari",
        job: "Own pilot rehearsals",
        skillPrompt: "Check the signoff list and name one missing baseline.",
        model: "opencode/deepseek-v4.1-flash-free",
        preset: "internal",
      });
      assert.equal(promptHistory(created.id).length, 1);
      assert.equal(promptHistory(created.id)[0].changeReason, "created");

      // A profile write carries all three fields; only the prompt is versioned.
      const base = {
        displayName: created.displayName,
        job: created.job,
        skillPrompt: created.skillPrompt,
        model: created.model,
        preset: created.preset,
      };

      // An instruction change without a reason is rejected and writes nothing.
      assert.throws(
        () =>
          saveExecutiveProfile(created.id, {
            ...base,
            skillPrompt: "Also demand a rollback owner.",
          }),
        (error: Error & { field?: string }) => error.field === "changeReason",
      );
      assert.equal(promptHistory(created.id).length, 1);

      // A non-prompt edit does not create a revision.
      saveExecutiveProfile(created.id, { ...base, job: "Own rehearsals and signoff" });
      assert.equal(promptHistory(created.id).length, 1);

      // A reasoned prompt change appends version 2 with the previous text preserved.
      saveExecutiveProfile(created.id, {
        ...base,
        skillPrompt: "Also demand a rollback owner.",
        changeReason: "Pilot review found no rollback owner.",
      });
      const history = promptHistory(created.id);
      assert.equal(history.length, 2);
      assert.equal(history[0].version, 2);
      assert.equal(history[0].previousPrompt, "Check the signoff list and name one missing baseline.");
      assert.equal(history[0].changeReason, "Pilot review found no rollback owner.");

      // Retiring the identity keeps its instruction history readable.
      db.update(s.executiveRoster)
        .set({ retiredAfter: 1 })
        .where(drizzleEq(s.executiveRoster.id, created.id))
        .run();
      assert.equal(promptHistory(created.id).length, 2);
    });

    await t.test("provider credentials never reach the database unsealed", async () => {
      const { db, schema: s } = await import("@/db");
      const { seal, unseal, SECRET_KEY_ENV } = await import("@/lib/secret-box");
      const saved = process.env[SECRET_KEY_ENV];
      process.env[SECRET_KEY_ENV] = "a-master-key-for-the-test-suite-0001";
      try {
        const { sealed, last4 } = seal("sk-live-very-secret-value-1234");
        assert.ok(sealed.startsWith("v1:"));
        assert.equal(last4, "1234");
        assert.equal(unseal(sealed), "sk-live-very-secret-value-1234");
        assert.equal(unseal(sealed.replace(/.$/, "A")), null, "tampering must not authenticate");

        db.update(s.opencodeConfigs).set({ apiKey: sealed }).run();
        const row = db.select().from(s.opencodeConfigs).get()!;
        assert.ok(!row.apiKey.includes("very-secret-value"));
      } finally {
        if (saved === undefined) delete process.env[SECRET_KEY_ENV];
        else process.env[SECRET_KEY_ENV] = saved;
      }
    });

    await t.test("a plaintext legacy key is not usable after the migration", async () => {
      const { db, schema: s } = await import("@/db");
      const { storedKey } = await import("@/lib/model-gateway");
      db.update(s.opencodeConfigs).set({ apiKey: "sk-legacy-plaintext" }).run();
      // The migration cleared rows at setup time; any plaintext that reappears is ignored.
      assert.equal(storedKey("sk-legacy-plaintext"), "");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("route discovery is stable", () => {
  assert.ok(ROUTE_FILES.length >= 20, `found ${ROUTE_FILES.length} route files`);
  assert.ok(ROUTE_FILES.includes("/api/boardroom"));
  assert.ok(ROUTE_FILES.includes("/api/executive-profiles/[role]"));
  assert.equal(relative("src/app/api", "src/app/api").length, 0);
});
