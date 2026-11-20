/**
 * Server-side guards for route handlers.
 *
 * The middleware is the outer gate; these run inside the handler so a misconfigured
 * matcher, an internal call or a future edge bypass still cannot reach CEO data.
 * Handler guards are the authoritative check — the middleware is defence in depth.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { AccessPrincipal } from "@/lib/enterprise-knowledge";
import { denyAnonymous, resolvePrincipal } from "@/lib/enterprise-knowledge";
import { authMode, csrfProblem, isMutating, misconfiguration, readSession } from "@/lib/session";

export interface VerifiedSession {
  subject: string;
  /** Explicit developer bypass (`CW_AUTH_DISABLED=1` outside production). */
  bypass: boolean;
}

/** Returns null when the caller has a valid session, or the response to send otherwise. */
export async function requireSession(req: NextRequest): Promise<NextResponse | null> {
  const mode = authMode();
  if (mode === "misconfigured") {
    const { status, error } = misconfiguration();
    return NextResponse.json({ error }, { status: status ?? 503 });
  }
  const session = await readSession(req.headers.get("cookie"));
  if (!session.ok) {
    return NextResponse.json(
      { error: session.error ?? "Sign in required." },
      { status: session.status ?? 401 },
    );
  }
  if (session.bypass) return null;
  if (isMutating(req.method)) {
    const problem = csrfProblem(req.headers, false);
    if (problem) return NextResponse.json({ error: problem }, { status: 403 });
  }
  return null;
}

export async function currentSession(req: NextRequest): Promise<VerifiedSession> {
  const session = await readSession(req.headers.get("cookie"));
  if (!session.ok || !session.session) throw new Error("requireSession must run first");
  return { subject: session.session.sub, bypass: Boolean(session.bypass) };
}

/**
 * Resolve the caller for the versioned enterprise plane.
 * A session is treated exactly like a CEO session was before auth existed, so no
 * existing authorization rule is loosened; anonymous callers are no longer granted it.
 */
export async function resolveApiPrincipal(
  req: NextRequest,
  bodyRole?: string,
  /** Retained for the handlers that pass a parsed role; the resolver never trusts it alone. */
  _note?: string,
): Promise<{ principal: AccessPrincipal; error?: string; status?: number }> {
  const mode = authMode();
  if (mode === "misconfigured") {
    return {
      principal: denyAnonymous(),
      error: misconfiguration().error,
      status: misconfiguration().status ?? 503,
    };
  }
  const session = await readSession(req.headers.get("cookie"));
  if (session.ok) {
    // A handler may have parsed the body before authorizing. That must not become a 500.
    try {
      return await resolvePrincipal(req, bodyRole, { asCeoSession: true });
    } catch (error) {
      console.error("resolveApiPrincipal failed:", error);
      return { principal: denyAnonymous(), error: "Could not resolve the request principal." };
    }
  }
  const authorization = req.headers.get("authorization");
  const apiKey = req.headers.get("x-api-key");
  const hasBearer = /^Bearer /i.test(authorization ?? "") || Boolean(apiKey);
  if (!hasBearer) {
    return {
      principal: denyAnonymous(),
      error: session.error ?? "Sign in required.",
      status: session.status ?? 401,
    };
  }
  if (isMutating(req.method)) {
    const problem = csrfProblem(req.headers, true);
    if (problem) return { principal: denyAnonymous(), error: problem };
  }
  const resolved = await resolvePrincipal(req, bodyRole, { asCeoSession: false });
  // A presented-but-invalid credential is an authentication failure (401), not a
  // permission failure: the caller never established who it is.
  if (!resolved.error) return resolved;
  return resolved.principal.authType === "role-simulation"
    ? { ...resolved, status: 401 } // retired or unknown identities fail authentication, as documented
    : { ...resolved, status: 401 };
}
