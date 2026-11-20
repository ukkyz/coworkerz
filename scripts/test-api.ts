/**
 * Test-only request plumbing for the Phase 0 authz matrix.
 *
 * Reaching a route handler directly (as every existing integration test does) skips the
 * middleware entirely. The matrix therefore checks both layers: the handler guard in
 * isolation, and the middleware `decideGate` contract that an HTTP request would hit.
 */
import { NextRequest } from "next/server";

export const ORIGIN = "http://suite.test";

export interface RouteContext {
  params: Promise<Record<string, string>>;
}

export function context(params: Record<string, string> = {}): RouteContext {
  return { params: Promise.resolve(params) };
}

/** Replace Next dynamic segments with a concrete value for the request path. */
export function concretePath(rule: string, fill = "fixture-id"): string {
  return rule.replace(/\[[^\]]+\]/g, fill);
}

export function buildRequest(
  method: string,
  path: string,
  init: {
    body?: unknown;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): NextRequest {
  const url = new URL(`${ORIGIN}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const headers = { ...(init.headers ?? {}) };
  const hasBody = init.body !== undefined;
  if (hasBody && !headers["content-type"]) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method,
    headers,
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
  });
}

export function isDenied(status: number): boolean {
  return status === 401 || status === 403;
}
