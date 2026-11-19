import { type NextRequest, NextResponse } from "next/server";
import { isExecutiveRole } from "@/lib/executives";
import { validateProfile } from "@/lib/executive-profiles";
import { saveExecutiveProfile } from "@/lib/executive-profile-store";
import { requireCeoConsole } from "../access";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  try {
    const denied = await requireCeoConsole(req);
    if (denied) return denied;
    const { role } = await params;
    if (!isExecutiveRole(role)) return NextResponse.json({ error: "Unknown executive role." }, { status: 404 });
    const result = validateProfile(await req.json().catch(() => null));
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    saveExecutiveProfile(role, result.profile);
    return NextResponse.json({ role, profile: result.profile });
  } catch {
    return NextResponse.json({ error: "The profile could not be saved. Try again." }, { status: 500 });
  }
}
