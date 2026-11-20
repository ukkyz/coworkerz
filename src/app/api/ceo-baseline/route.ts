import { type NextRequest, NextResponse } from "next/server";
import { requireCeoConsole } from "@/app/api/executive-profiles/access";
import { BaselineError, captureCeoBaseline, readCeoRadar } from "@/lib/ceo-baseline-store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const unavailable = () =>
  json(
    { error: "Could not access the CEO baseline. Check the database migration and retry." },
    500,
  );

export async function GET(req: NextRequest) {
  try {
    return (await requireCeoConsole(req)) ?? json(readCeoRadar());
  } catch {
    return unavailable();
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req);
    if (denied) return denied;
    const body = await req.json().catch(() => null);
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 0
    ) {
      return json(
        { error: "Send only the expected baseline revision (0 for the first capture)." },
        400,
      );
    }
    return json(captureCeoBaseline(body.expectedRevision), body.expectedRevision === 0 ? 201 : 200);
  } catch (error) {
    return error instanceof BaselineError
      ? json({ error: error.message }, error.status)
      : unavailable();
  }
}
