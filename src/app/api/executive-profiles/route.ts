import { type NextRequest, NextResponse } from "next/server";
import { createExecutive, rosterPayload } from "@/lib/executive-profile-store";
import { withCeo } from "./access";
export const dynamic = "force-dynamic";
export const GET = (req: NextRequest) =>
  withCeo(req, () =>
    NextResponse.json(rosterPayload(), { headers: { "Cache-Control": "no-store" } }),
  );
export const POST = (req: NextRequest) =>
  withCeo(req, async () => {
    const executive = createExecutive(await req.json().catch(() => null));
    return NextResponse.json({ executive, ...rosterPayload() }, { status: 201 });
  });
