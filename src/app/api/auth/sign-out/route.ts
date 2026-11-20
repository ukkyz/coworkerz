import { NextResponse } from "next/server";
import {
  csrfProblem,
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_COOKIE_PLAIN,
  sessionCookieName,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Clear the session and CSRF cookies. Deliberately requires no session: signing out when
 * already signed out is not an error, and refusing would leak whether a cookie is valid.
 *
 * Every name we might ever have set is cleared, with attributes that match how it was set
 * (`__Host-` requires Secure, so it is only emitted for a production deployment).
 */
export async function POST(req: Request) {
  const problem = csrfProblem(req.headers, false);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 403, headers: NO_STORE });
  }

  const production = process.env.NODE_ENV === "production";
  const secure = production ? "; Secure" : "";
  const names = new Set([sessionCookieName(), SESSION_COOKIE_PLAIN]);
  if (production) names.add(SESSION_COOKIE);

  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  for (const name of names) {
    response.headers.append(
      "Set-Cookie",
      `${name}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`,
    );
  }
  response.headers.append(
    "Set-Cookie",
    `${CSRF_COOKIE}=; Path=/; SameSite=Lax${secure}; Max-Age=0`,
  );
  return response;
}
