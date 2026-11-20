/**
 * Session primitives and the fail-closed decision table.
 *
 * This module is evaluated in the middleware runtime, where only the Web Crypto
 * globals exist. Do not import `node:crypto`, the database or `next/headers` here.
 * The route-level guards in `src/lib/access.ts` build on these pure functions.
 */

/**
 * The `__Host-` prefix is the strongest cookie binding available, but it *requires* the
 * Secure attribute, which a browser only accepts over HTTPS. Deployments terminate TLS, so
 * they get the prefix; a local http:// dev server uses the plain name. Both are accepted on
 * read, so an environment change does not silently strand a valid session.
 */
export const SESSION_COOKIE = "__Host-cw_session";
export const SESSION_COOKIE_PLAIN = "cw_session";

export function sessionCookieName(env: NodeJS.ProcessEnv = process.env): string {
  return env.NODE_ENV === "production" ? SESSION_COOKIE : SESSION_COOKIE_PLAIN;
}

/** Serialise both session cookies. Shared by sign-in and sign-out so clearing matches setting. */
export function sessionCookieHeaders(options: {
  token?: string;
  csrf?: string;
  maxAge: number;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const env = options.env ?? process.env;
  const name = sessionCookieName(env);
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  const base = `Path=/; SameSite=Lax${secure}; Max-Age=${options.maxAge}`;
  const headers = [`${name}=${options.token ? encodeURIComponent(options.token) : ""}; HttpOnly; ${base}`];
  // The CSRF token is deliberately readable: the client echoes it in X-CSRF-Token.
  headers.push(`${CSRF_COOKIE}=${options.csrf ? encodeURIComponent(options.csrf) : ""}; ${base}`);
  return headers;
}
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const MIN_SECRET_LENGTH = 32;

/** Escape hatch for local demos and the pre-auth browser suites. Never allowed in production. */
export const AUTH_DISABLED_ENV = "CW_AUTH_DISABLED";
export const SESSION_SECRET_ENV = "CW_SESSION_SECRET";

export const CSRF_COOKIE = "cw_csrf";

export type AuthMode = "session" | "disabled" | "misconfigured";

export interface SessionClaims {
  /** Opaque subject. Phase 0 has exactly one: the human in the CEO seat. */
  sub: string;
  /** Double-submit token, mirrored into the readable cookie for the client. */
  csrf: string;
  iat: number;
  exp: number;
}

export interface SessionResult {
  ok: boolean;
  session?: SessionClaims;
  /** True only when the operator explicitly opted out in a non-production build. */
  bypass?: boolean;
  error?: string;
  status?: number;
}

const encoder = new TextEncoder();

export function authMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  if (env[AUTH_DISABLED_ENV] === "1") {
    // Refuse to boot open in production, whatever the operator intended.
    return env.NODE_ENV === "production" ? "misconfigured" : "disabled";
  }
  const secret = env[SESSION_SECRET_ENV];
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH
    ? "session"
    : "misconfigured";
}

export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env[SESSION_SECRET_ENV];
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function misconfiguration(): SessionResult {
  const disabledInProduction = process.env[AUTH_DISABLED_ENV] === "1";
  return {
    ok: false,
    status: 503,
    error: disabledInProduction
      ? `${AUTH_DISABLED_ENV} is refused in production. Remove it and configure ${SESSION_SECRET_ENV}.`
      : `Authentication is not configured. Set ${SESSION_SECRET_ENV} to at least ${MIN_SECRET_LENGTH} characters.`,
  };
}

/* ------------------------------------------------------------------ */
/* base64url + HMAC                                                    */
/* ------------------------------------------------------------------ */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function isClaims(value: unknown): value is SessionClaims {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.sub === "string" &&
    c.sub.length > 0 &&
    typeof c.csrf === "string" &&
    c.csrf.length > 0 &&
    typeof c.iat === "number" &&
    Number.isFinite(c.iat) &&
    typeof c.exp === "number" &&
    Number.isFinite(c.exp)
  );
}

/** Copy into a plain ArrayBuffer so the Web Crypto BufferSource types are satisfied. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function signSession(
  claims: SessionClaims,
  secret: string,
): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    toArrayBuffer(encoder.encode(payload)),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySession(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now(),
): Promise<SessionClaims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const sigBytes = fromBase64Url(signature);
  const bodyBytes = fromBase64Url(payload);
  if (!sigBytes || !bodyBytes) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      toArrayBuffer(sigBytes),
      toArrayBuffer(encoder.encode(payload)),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return null;
  }
  if (!isClaims(parsed)) return null;
  // Reject both expired and not-yet-valid tokens; clock skew is capped at one minute.
  if (parsed.exp <= now || parsed.iat > now + 60_000) return null;
  return parsed;
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/**
 * The single authority for "may this request proceed?".
 * No credential is never a CEO. A missing or unreadable secret is a 503, not an allow.
 */
export async function readSession(
  cookieHeader: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionResult> {
  const mode = authMode(env);
  if (mode === "misconfigured") return misconfiguration();
  if (mode === "disabled") {
    return {
      ok: true,
      bypass: true,
      session: {
        sub: "CEO",
        csrf: "dev-bypass",
        iat: Date.now(),
        exp: Date.now() + SESSION_TTL_MS,
      },
    };
  }
  const token =
    readCookie(cookieHeader, sessionCookieName(env)) ??
    readCookie(cookieHeader, SESSION_COOKIE) ??
    readCookie(cookieHeader, SESSION_COOKIE_PLAIN);
  const claims = await verifySession(token, sessionSecret(env)!);
  if (!claims) {
    return { ok: false, status: 401, error: "Sign in required." };
  }
  return { ok: true, session: claims };
}

/* ------------------------------------------------------------------ */
/* Route policy                                                        */
/* ------------------------------------------------------------------ */

/** `public` needs no credential; `session` is the trusted CEO console; `key` accepts a bearer key. */
export type RouteAuth = "public" | "session" | "session-or-key";

export interface RouteRule {
  /** Path with Next.js dynamic segments kept literal, e.g. `/api/executive-profiles/[role]`. */
  path: string;
  methods: string[];
  auth: RouteAuth;
  /** A second, artificial barrier inside the handler (never a substitute for `auth`). */
  note?: string;
}

/**
 * Every file under `src/app/api`. `scripts/authz.test.ts` fails if the filesystem and this
 * table disagree, so a new route cannot ship without a deliberate auth classification.
 */
export const API_ROUTE_RULES: RouteRule[] = [
  { path: "/api/health", methods: ["GET"], auth: "public" },
  { path: "/api/auth/sign-in", methods: ["POST"], auth: "public" },
  { path: "/api/auth/sign-out", methods: ["POST"], auth: "public" },
  { path: "/api/auth/session", methods: ["GET"], auth: "public" },

  { path: "/api/boardroom", methods: ["GET"], auth: "session" },
  { path: "/api/ceo-baseline", methods: ["GET", "POST"], auth: "session" },
  { path: "/api/ceo-message", methods: ["POST"], auth: "session" },
  { path: "/api/deliberate/step", methods: ["POST"], auth: "session" },
  { path: "/api/executive-profiles", methods: ["GET", "POST"], auth: "session" },
  { path: "/api/executive-profiles/[role]", methods: ["PUT", "POST", "DELETE"], auth: "session" },
  { path: "/api/knowledge", methods: ["GET", "POST", "DELETE"], auth: "session" },
  { path: "/api/memory", methods: ["GET", "POST"], auth: "session" },
  { path: "/api/memory/file", methods: ["GET"], auth: "session" },
  { path: "/api/opencode-config", methods: ["GET", "PUT", "POST"], auth: "session" },
  { path: "/api/sessions", methods: ["POST", "DELETE"], auth: "session" },

  { path: "/api/v1/agent-memory", methods: ["GET"], auth: "session-or-key" },
  { path: "/api/v1/enterprise/api-keys", methods: ["GET", "POST", "DELETE"], auth: "session-or-key", note: "handler still requires the CEO session to mint keys" },
  { path: "/api/v1/enterprise/classify", methods: ["POST"], auth: "session-or-key" },
  { path: "/api/v1/enterprise/documents", methods: ["GET", "POST"], auth: "session-or-key" },
  { path: "/api/v1/enterprise/documents/[id]", methods: ["GET", "PATCH", "DELETE"], auth: "session-or-key" },
  { path: "/api/v1/enterprise/graph", methods: ["GET", "POST"], auth: "session-or-key" },
  { path: "/api/v1/enterprise/mindmap", methods: ["GET"], auth: "session-or-key" },
  { path: "/api/v1/enterprise/openapi", methods: ["GET"], auth: "session-or-key" },
  { path: "/api/v1/enterprise/retrieve", methods: ["GET", "POST"], auth: "session-or-key" },
  { path: "/api/v1/enterprise/taxonomy", methods: ["GET", "PUT"], auth: "session-or-key" },
];

/** Pages other than these require a session. `/login` is the only anonymous document. */
export const PUBLIC_PAGE_PATHS = ["/login"];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutating(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

function escapeSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toMatcher(path: string): RegExp {
  const pattern = path
    .split("/")
    .map((segment) => (/^\[.+\]$/.test(segment) ? "[^/]+" : escapeSegment(segment)))
    .join("/");
  return new RegExp(`^${pattern}$`);
}

const MATCHERS = API_ROUTE_RULES.map((rule) => ({ rule, matcher: toMatcher(rule.path) }));

/** Resolve a concrete request path to its policy. Unknown API paths are denied, not ignored. */
export function classifyPath(pathname: string): { rule: RouteRule; known: boolean } | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (!path.startsWith("/api/")) return null;
  for (const { rule, matcher } of MATCHERS) {
    if (matcher.test(path)) return { rule, known: true };
  }
  return null;
}

export type GateDecision =
  | { allow: true; bypass: boolean }
  | { allow: false; status: number; error: string };

/**
 * The middleware contract. Deny by default: an unrecognised path under /api is 404-shaped,
 * and every recognised path needs either a session or (for the v1 plane) a bearer key.
 */
export async function decideGate(
  pathname: string,
  method: string,
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GateDecision> {
  if (pathname === "/api/health") return { allow: true, bypass: false };

  const match = classifyPath(pathname);
  if (!match) {
    // Deny-by-default: a path we cannot classify is not a path we can authorize.
    return { allow: false, status: 404, error: "Unknown route." };
  }
  const { rule } = match;
  if (rule.auth === "public") return { allow: true, bypass: false };

  const session = await readSession(headers.get("cookie"), env);
  if (session.ok) return { allow: true, bypass: Boolean(session.bypass) };
  if (session.bypass) return { allow: true, bypass: true };

  if (rule.auth === "session-or-key") {
    const authorization = headers.get("authorization");
    const apiKey = headers.get("x-api-key");
    if ((authorization && /^Bearer /i.test(authorization)) || apiKey) {
      // The handler validates the key against the database; the edge only checks presence.
      return { allow: true, bypass: false };
    }
  }
  return {
    allow: false,
    status: session.status ?? 401,
    error: session.error ?? "Sign in required.",
  };
}

/**
 * Cross-site request forgery. Cookie-authenticated mutations must prove same-origin.
 * Bearer callers are immune (no ambient credential), so they skip the check.
 */
export function csrfProblem(headers: Headers, isBearer: boolean): string | null {
  if (isBearer) return null;
  const site = headers.get("sec-fetch-site");
  if (site === "same-origin") return null;
  if (site && site !== "same-origin" && site !== "none") {
    return "Cross-site request refused.";
  }
  const origin = headers.get("origin");
  if (!origin) {
    // No Origin and no Sec-Fetch-Site: curl, server-to-server or a stripped proxy.
    // There is no ambient browser credential to forge, so this is legacy-client compatible.
    return null;
  }
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    return "Malformed Origin header.";
  }
  const forwardedHost = headers.get("x-forwarded-host");
  const expected = (forwardedHost ?? headers.get("host") ?? "").split(",")[0].trim();
  if (!expected) return "Cannot verify request origin.";
  return host === expected ? null : "Cross-site request refused.";
}
