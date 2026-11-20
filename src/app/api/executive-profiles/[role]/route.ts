import { type NextRequest, NextResponse } from "next/server";
import {
  archiveExecutive,
  createExecutive,
  requireActive,
  rosterPayload,
  saveExecutiveProfile,
} from "@/lib/executive-profile-store";
import { profileOf } from "@/lib/roster";
import { withCeo } from "../access";

type Context = { params: Promise<{ role: string }> };
export const PUT = (req: NextRequest, { params }: Context) =>
  withCeo(req, async () => {
    const { role } = await params;
    requireActive(role);
    const executive = saveExecutiveProfile(role, await req.json().catch(() => null));
    return NextResponse.json({
      role,
      profile: profileOf(executive),
      executive,
      ...rosterPayload(),
    });
  });
export const POST = (req: NextRequest, { params }: Context) =>
  withCeo(req, async () => {
    const executive = createExecutive(await req.json().catch(() => null), (await params).role);
    return NextResponse.json({ executive, ...rosterPayload() }, { status: 201 });
  });
export const DELETE = (req: NextRequest, { params }: Context) =>
  withCeo(req, async () => {
    archiveExecutive((await params).role);
    return NextResponse.json(rosterPayload());
  });
