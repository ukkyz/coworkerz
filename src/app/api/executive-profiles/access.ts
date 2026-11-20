import { RosterError } from "@/lib/executive-profile-store";
import { type NextRequest, NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/enterprise-knowledge";

// Like the rest of the local boardroom, the interactive console assumes a trusted CEO.
// An enterprise API key or a simulated executive is not a settings principal.
export async function requireCeoConsole(req: NextRequest) {
  const { principal, error } = await resolvePrincipal(req);
  if (error) return NextResponse.json({ error }, { status: 401 });
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
