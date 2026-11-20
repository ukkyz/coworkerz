import { NextRequest, NextResponse } from "next/server";
import {
  generateEnterpriseMindmap,
} from "@/lib/enterprise-knowledge";
import { resolveApiPrincipal } from "@/lib/access";

/** Session-aware version of the enterprise resolver: no session and no key is a 401. */
async function resolveEnterprisePrincipal(req: NextRequest, bodyRole?: string) {
  const auth = await resolveApiPrincipal(req, bodyRole);
  if (auth.error)
    // Anonymous, an invalid key and a retired identity all fail authentication (401);
    // a valid non-CEO credential is a permission failure (403).
    return {
      ...auth,
      status:
        auth.status ??
        (auth.principal.authType === "api-key" ? 403 : 401),
    };
  if (!auth.principal.allowedDomains.length)
    return { ...auth, error: "No enterprise access in this scope.", status: 403 };
  return { ...auth, status: 200 };
}

export const dynamic = "force-dynamic";

const HEADERS = {
  "X-Knowledge-Plane": "enterprise_knowledge",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, X-Simulate-Role",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveEnterprisePrincipal(req);
    if (auth.error) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: HEADERS }
      );
    }

    const domain = req.nextUrl.searchParams.get("domain") || "ALL";
    const includeCrossDomain =
      req.nextUrl.searchParams.get("includeCrossDomain") !== "false";
    const format = (req.nextUrl.searchParams.get("format") || "json").toLowerCase();

    const result = await generateEnterpriseMindmap({
      principal: auth.principal,
      domainFilter: domain,
      includeCrossDomain,
    });

    if (format === "mermaid" || format === "mmd" || format === "text") {
      return new NextResponse(result.mermaidCode, {
        headers: {
          ...HEADERS,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    return NextResponse.json(
      {
        plane: "enterprise_knowledge",
        agentMemoryIsolated: true,
        ...result,
      },
      { headers: HEADERS }
    );
  } catch (error) {
    console.error("GET /api/v1/enterprise/mindmap failed:", error);
    return NextResponse.json(
      { error: "Failed to build Enterprise Knowledge mindmap" },
      { status: 500, headers: HEADERS }
    );
  }
}
