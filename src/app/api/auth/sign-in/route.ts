import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  AUTH_DISABLED_ENV,
  authMode,
  misconfiguration,
  SESSION_TTL_MS,
  sessionCookieHeaders,
  sessionSecret,
  signSession,
  toBase64Url,
} from "@/lib/session";
import { CEO_ACCESS_CODE_ENV, clientKey, recordFailure, signInGate } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Constant-time comparison that does not leak length through an early return. */
function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** Mint the session cookie. Called only after a valid access code. */
export async function POST(req: Request) {
  const mode = authMode();
  if (mode === "misconfigured") {
    const { status, error } = misconfiguration();
    return NextResponse.json({ error }, { status: status ?? 503, headers: NO_STORE });
  }
  if (mode === "disabled") {
    return NextResponse.json(
      { error: `${AUTH_DISABLED_ENV} is set; this non-production build needs no sign-in.` },
      { status: 400, headers: NO_STORE },
    );
  }

  const gate = signInGate(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status, headers: NO_STORE });
  }

  let body: { accessCode?: unknown };
  try {
    body = (await req.json()) as { accessCode?: unknown };
  } catch {
    recordFailure(clientKey(req));
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400, headers: NO_STORE },
    );
  }
  const submitted = typeof body.accessCode === "string" ? body.accessCode.trim() : "";
  const expected = process.env[CEO_ACCESS_CODE_ENV]?.trim() ?? "";
  if (!submitted || !expected || !safeEqual(submitted, expected)) {
    recordFailure(clientKey(req));
    return NextResponse.json(
      { error: "That access code is not valid." },
      { status: 401, headers: NO_STORE },
    );
  }

  const now = Date.now();
  const claims = {
    sub: "CEO",
    csrf: toBase64Url(crypto.getRandomValues(new Uint8Array(24))),
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const token = await signSession(claims, sessionSecret()!);
  const response = NextResponse.json({ ok: true, subject: claims.sub }, { headers: NO_STORE });
  for (const cookie of sessionCookieHeaders({
    token,
    csrf: claims.csrf,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }))
    response.headers.append("Set-Cookie", cookie);
  return response;
}
