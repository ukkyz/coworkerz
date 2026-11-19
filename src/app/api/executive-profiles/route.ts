import { type NextRequest, NextResponse } from "next/server";
import { getExecutiveProfiles } from "@/lib/executive-profile-store";
import { requireCeoConsole } from "./access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req);
    if (denied) return denied;
    return NextResponse.json({ profiles: getExecutiveProfiles() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load executive profiles. Check the SQLite migrations." }, { status: 500 });
  }
}
