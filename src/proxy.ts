import { NextResponse, type NextRequest } from "next/server";
import {
  authMode,
  csrfProblem,
  decideGate,
  isMutating,
  misconfiguration,
  PUBLIC_PAGE_PATHS,
  readSession,
} from "@/lib/session";

/**
 * Deny-by-default. Everything is a 401 until a signed session cookie proves otherwise,
 * except the three anonymous API paths (health and the sign-in ritual) and the login page.
 *
 * Next 16.4 names this file `proxy.ts` (`middleware.ts` is deprecated but still accepted).
 * The exported symbol must match the filename. This runs in the proxy runtime, so it must
 * not import the database or `node:*` modules; only WebCrypto and `fetch` are available.
 */
const ALLOWED = new Set(["/api/health", "/api/auth/sign-in", "/api/auth/sign-out", "/api/auth/session", ...PUBLIC_PAGE_PATHS]);

const NO_STORE = { "Cache-Control": "no-store", Vary: "Cookie, Authorization" } as const;

function wantsHtml(req: NextRequest): boolean {
  return (req.headers.get("accept") ?? "").includes("text/html");
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // `/api/health` is the readiness probe: it must be able to name the problem, not be
  // replaced by a generic route-policy denial.
  if (pathname === "/api/health") return NextResponse.next();

  if (authMode() === "misconfigured") {
    const { status, error } = misconfiguration();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error }, { status: status ?? 503, headers: NO_STORE });
    }
    if (wantsHtml(req)) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?error=${encodeURIComponent((error ?? "Authentication is not configured.").slice(0, 160))}`;
      return NextResponse.redirect(url);
    }
  }

  if (ALLOWED.has(pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    const decision = await decideGate(pathname, req.method, req.headers);
    if (!decision.allow) {
      return NextResponse.json(
        { error: decision.error },
        { status: decision.status, headers: NO_STORE },
      );
    }
    // CSRF applies to cookie-authenticated mutations; bearer keys are not ambient credentials.
    if (isMutating(req.method) && !decision.bypass) {
      const bearer =
        /^Bearer /i.test(req.headers.get("authorization") ?? "") ||
        Boolean(req.headers.get("x-api-key"));
      const problem = csrfProblem(req.headers, bearer);
      if (problem) {
        return NextResponse.json({ error: problem }, { status: 403, headers: NO_STORE });
      }
    }
    return NextResponse.next({ headers: NO_STORE });
  }

  // Documents: a signed-out browser is sent to the login page carrying its destination.
  const session = await readSession(req.headers.get("cookie"));
  if (session.ok) return NextResponse.next({ headers: NO_STORE });

  if (wantsHtml(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.json(
    { error: session.error ?? "Sign in required." },
    { status: session.status ?? 401, headers: NO_STORE },
  );
}

export const config = {
  // Everything except Next internals and static files. Images are public assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
