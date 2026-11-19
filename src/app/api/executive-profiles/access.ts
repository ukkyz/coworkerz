import { type NextRequest, NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/enterprise-knowledge";

// Like the rest of the local boardroom, the interactive console assumes a trusted CEO.
// An enterprise API key or a simulated executive is not a settings principal.
export async function requireCeoConsole(req: NextRequest) {
  const { principal, error } = await resolvePrincipal(req);
  if (error) return NextResponse.json({ error }, { status: 401 });
  if (principal.authType !== "ceo-session") {
    return NextResponse.json({ error: "Executive profiles are CEO console settings." }, { status: 403 });
  }
}
