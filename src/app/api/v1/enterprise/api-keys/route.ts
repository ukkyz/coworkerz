import { NextRequest, NextResponse } from "next/server";
import { RosterError } from "@/lib/executive-profile-store";
import type { ClearanceLevel, PrincipalRole } from "@/db/schema";
import {
  createEnterpriseApiKey,
  listEnterpriseApiKeys,
  resolvePrincipal,
  revokeEnterpriseApiKey,
} from "@/lib/enterprise-knowledge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await resolvePrincipal(req);
    if (auth.error || auth.principal.authType !== "ceo-session") {
      return NextResponse.json(
        { error: "CEO session required to inspect API keys." },
        { status: 403 }
      );
    }
    const keys = await listEnterpriseApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.error("GET /api/v1/enterprise/api-keys failed:", error);
    return NextResponse.json(
      { error: "Failed to load API keys" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolvePrincipal(req);
    if (auth.error || auth.principal.authType !== "ceo-session") {
      return NextResponse.json(
        { error: "Only the CEO may mint Enterprise Knowledge API keys." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      name?: string;
      assignedRole?: PrincipalRole;
      allowedDomains?: string[];
      clearanceLevel?: ClearanceLevel;
      canWrite?: boolean;
      canReadAgentMemory?: boolean;
    };

    const name = (body.name || "").trim();
    if (name.length < 2) {
      return NextResponse.json(
        { error: "Client `name` is required." },
        { status: 400 }
      );
    }

    const minted = await createEnterpriseApiKey({
      name,
      assignedRole: body.assignedRole || "EXTERNAL_AGENT",
      allowedDomains: body.allowedDomains,
      clearanceLevel: body.clearanceLevel,
      canWrite: body.canWrite,
      canReadAgentMemory: body.canReadAgentMemory,
    });

    return NextResponse.json(minted, { status: 201 });
  } catch (error) {
    if (error instanceof RosterError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("POST /api/v1/enterprise/api-keys failed:", error);
    return NextResponse.json(
      { error: "Failed to mint API key" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await resolvePrincipal(req);
    if (auth.error || auth.principal.authType !== "ceo-session") {
      return NextResponse.json(
        { error: "Only the CEO may revoke API keys." },
        { status: 403 }
      );
    }
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "Valid `id` required." }, { status: 400 });
    }
    await revokeEnterpriseApiKey(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/v1/enterprise/api-keys failed:", error);
    return NextResponse.json(
      { error: "Failed to revoke API key" },
      { status: 500 }
    );
  }
}
