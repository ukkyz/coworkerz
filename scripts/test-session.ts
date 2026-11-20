/**
 * Test-only helpers for the Phase 0 suites. Not imported by application code.
 *
 * Route handlers verify a cookie in Phase 0, so every integration test that exercises the
 * CEO console must present a real signed session rather than relying on the absence of a
 * credential. The token is signed here with node:crypto, which produces the same bytes the
 * application verifies with WebCrypto — so tests stay synchronous.
 */
import { createHmac } from "node:crypto";
import { SESSION_COOKIE_PLAIN, type SessionClaims } from "@/lib/session";

export const TEST_SESSION_SECRET = "test-session-secret-that-is-long-enough-0001";
export const TEST_ACCESS_CODE = "test-access-code-0001";

function base64url(bytes: Buffer): string {
  return bytes.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function configureTestAuth(env: NodeJS.ProcessEnv = process.env): void {
  env.CW_SESSION_SECRET = TEST_SESSION_SECRET;
  env.CEO_ACCESS_CODE = TEST_ACCESS_CODE;
  delete env.CW_AUTH_DISABLED;
}

export function claimsFor(sub = "CEO"): SessionClaims {
  const now = Date.now();
  return { sub, csrf: "test-csrf", iat: now, exp: now + 60 * 60 * 1000 };
}

/** Synchronous twin of `signSession`, for request builders that cannot await. */
export function sessionToken(
  claims: SessionClaims = claimsFor(),
  secret = TEST_SESSION_SECRET,
): string {
  const payload = base64url(Buffer.from(JSON.stringify(claims), "utf8"));
  const signature = createHmac("sha256", secret).update(payload).digest();
  return `${payload}.${base64url(signature)}`;
}

/**
 * Headers that make a request look like a signed-in browser: the session cookie plus a
 * same-origin Fetch metadata marker so the CSRF check behaves as it would in the UI.
 */
export function sessionHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...extra,
    // Tests run outside a production build, so the plain (Secure-less) name is correct here.
    cookie: `${SESSION_COOKIE_PLAIN}=${encodeURIComponent(sessionToken())}`,
    "sec-fetch-site": "same-origin",
  };
}
