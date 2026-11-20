import { RosterError } from "@/lib/executive-profile-store";
import { type NextRequest, NextResponse } from "next/server";
import { resolveApiPrincipal } from "@/lib/access";
import { authMode, misconfiguration } from "@/lib/session";
import { resolvePrincipal } from "@/lib/enterprise-knowledge";

/**
 * Like the rest of the local boardroom, the interactive console assumes a trusted CEO —
 * but "trusted" now means *a verified signed-in session*, not *nobody sent a credential*.
 * An enterprise API key or a simulated executive is still not a settings principal.
 */
export async function requireCeoConsole(req: NextRequest) {
  // An unconfigured deployment is an operator error, not an authentication failure.
  if (authMode() === "misconfigured") {
    const { status, error } = misconfiguration();
    return NextResponse.json({ error }, { status: status ?? 503, headers: { "Cache-Control": "no-store" } });
  }
  // A presented-but-invalid credential never establishes an identity: 401, not 403.
  if (req.headers.has("authorization") || req.headers.has("x-api-key")) {
    const auth = await resolvePrincipal(req);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const { principal, error } = await resolveApiPrincipal(req);
  if (error) {
    return NextResponse.json(
      { error },
      { status: principal.authType === "anonymous" ? 401 : 403 },
    );
  }
  if (principal.authType !== "ceo-session") {
    return NextResponse.json(
      { error: "This action requires the trusted CEO console." },
      { status: 403 },
    );
  }
}

export async function withCeo(req: NextRequest, action: () => Response | Promise<Response>) {
  try {
    return (await requireCeoConsole(req)) ?? (await action());
  } catch (error) {
    if (error instanceof RosterError)
      return NextResponse.json(
        { error: error.message, field: error.field },
        { status: error.status },
      );
    return NextResponse.json(
      { error: "Could not access the executive roster. Check the database migrations." },
      { status: 500 },
    );
  }
}
