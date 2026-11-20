import { NextResponse } from "next/server";
import { AUTH_DISABLED_ENV, authMode, misconfiguration, readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Read-only probe used by the login page and the client before it renders the console. */
export async function GET(req: Request) {
  const mode = authMode();
  if (mode === "disabled") {
    return NextResponse.json(
      {
        signedIn: true,
        bypass: true,
        note: `${AUTH_DISABLED_ENV} is set for this non-production build.`,
      },
      { headers: NO_STORE },
    );
  }
  if (mode === "misconfigured") {
    const { status, error } = misconfiguration();
    return NextResponse.json(
      { signedIn: false, error },
      { status: status ?? 503, headers: NO_STORE },
    );
  }
  const session = await readSession(req.headers.get("cookie"));
  if (!session.ok || !session.session) {
    return NextResponse.json({ signedIn: false }, { status: 401, headers: NO_STORE });
  }
  return NextResponse.json(
    {
      signedIn: true,
      subject: session.session.sub,
      expiresAt: new Date(session.session.exp).toISOString(),
    },
    { headers: NO_STORE },
  );
}
