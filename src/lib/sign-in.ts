/**
 * Sign-in policy shared by the auth routes: origin proof, a brute-force budget and the
 * single-operator access code. Kept separate so the rate limiter can be tested in isolation.
 */
import { csrfProblem } from "@/lib/session";

export const CEO_ACCESS_CODE_ENV = "CEO_ACCESS_CODE";
export const SIGN_IN_MAX_ATTEMPTS = 5;
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

interface Bucket {
  count: number;
  resetAt: number;
}

// Process-local. A multi-instance deployment needs this moved to Redis or the database;
// the interface is the same and the tests pin the behaviour either way.
const buckets = new Map<string, Bucket>();

export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

export function attemptStatus(
  key: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
  const allowed = bucket.count < SIGN_IN_MAX_ATTEMPTS;
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Count a failed attempt. Successes do not clear the bucket: the budget is per window. */
export function recordFailure(key: string, now: number = Date.now()): void {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + SIGN_IN_WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

export function resetSignInState(): void {
  buckets.clear();
}

export function signInGate(
  req: Request,
  now: number = Date.now(),
): { ok: true } | { ok: false; status: number; error: string } {
  // Sign-in is a cookie-minting mutation, so it must prove same-origin.
  const problem = csrfProblem(req.headers, false);
  if (problem) return { ok: false, status: 403, error: problem };

  const status = attemptStatus(clientKey(req), now);
  if (!status.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Too many sign-in attempts. Try again in ${status.retryAfterSeconds} seconds.`,
    };
  }

  if (!process.env[CEO_ACCESS_CODE_ENV]?.trim()) {
    return {
      ok: false,
      status: 503,
      error: `${CEO_ACCESS_CODE_ENV} is not configured on this server.`,
    };
  }
  return { ok: true };
}
