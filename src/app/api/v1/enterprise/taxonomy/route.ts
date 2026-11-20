import { NextRequest, NextResponse } from "next/server";
import {
  getActiveTaxonomyScheme,
  resolveEnterprisePrincipal,
  updateTaxonomyScheme,
} from "@/lib/enterprise-knowledge";

export const dynamic = "force-dynamic";

const HEADERS = {
  "X-Knowledge-Plane": "enterprise_knowledge",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, X-Simulate-Role",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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

    const scheme = await getActiveTaxonomyScheme();
    const format = (req.nextUrl.searchParams.get("format") || "json").toLowerCase();
    const download = req.nextUrl.searchParams.get("download") === "1";

    if (format === "yaml") {
      return new NextResponse(scheme.yamlContent, {
        headers: {
          ...HEADERS,
          "Content-Type": "text/yaml; charset=utf-8",
          ...(download
            ? {
                "Content-Disposition": `attachment; filename="aether-taxonomy-v${scheme.version}.skos.yaml"`,
              }
            : {}),
        },
      });
    }

    if (format === "skos-turtle" || format === "turtle" || format === "ttl") {
      return new NextResponse(scheme.skosTurtle, {
        headers: {
          ...HEADERS,
          "Content-Type": "text/turtle; charset=utf-8",
          ...(download
            ? {
                "Content-Disposition": `attachment; filename="aether-taxonomy-v${scheme.version}.skos.ttl"`,
              }
            : {}),
        },
      });
    }

    return NextResponse.json(
      {
        plane: "enterprise_knowledge",
        scheme: {
          id: scheme.id,
          schemeUri: scheme.schemeUri,
          title: scheme.title,
          version: scheme.version,
          format: scheme.format,
          conceptCount: scheme.parsedConcepts.length,
          updatedBy: scheme.updatedBy,
          updatedAt: scheme.updatedAt,
          yamlContent: scheme.yamlContent,
          skosTurtle: scheme.skosTurtle,
          concepts: scheme.parsedConcepts,
        },
      },
      { headers: HEADERS }
    );
  } catch (error) {
    console.error("GET /api/v1/enterprise/taxonomy failed:", error);
    return NextResponse.json(
      { error: "Failed to load enterprise taxonomy" },
      { status: 500, headers: HEADERS }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await resolveEnterprisePrincipal(req);
    if (auth.error) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: HEADERS }
      );
    }
    if (!auth.principal.canWrite || auth.principal.role !== "CEO") {
      return NextResponse.json(
        { error: "Only CEO principal may modify the formal enterprise taxonomy scheme." },
        { status: 403, headers: HEADERS }
      );
    }

    const body = (await req.json()) as {
      yamlContent?: string;
      reclassifyAll?: boolean;
    };

    if (!body.yamlContent || body.yamlContent.trim().length < 20) {
      return NextResponse.json(
        { error: "`yamlContent` is required." },
        { status: 400, headers: HEADERS }
      );
    }

    const result = await updateTaxonomyScheme({
      yamlContent: body.yamlContent,
      updatedBy: auth.principal.role,
      reclassifyAll: Boolean(body.reclassifyAll),
    });

    return NextResponse.json(
      {
        plane: "enterprise_knowledge",
        scheme: {
          id: result.scheme.id,
          schemeUri: result.scheme.schemeUri,
          title: result.scheme.title,
          version: result.scheme.version,
          format: result.scheme.format,
          conceptCount: result.scheme.parsedConcepts.length,
          updatedBy: result.scheme.updatedBy,
          updatedAt: result.scheme.updatedAt,
          yamlContent: result.scheme.yamlContent,
          skosTurtle: result.scheme.skosTurtle,
          concepts: result.scheme.parsedConcepts,
        },
        warnings: result.warnings,
        reclassifiedCount: result.reclassifiedCount,
      },
      { headers: HEADERS }
    );
  } catch (error) {
    console.error("PUT /api/v1/enterprise/taxonomy failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid YAML/SKOS taxonomy document.",
      },
      { status: 400, headers: HEADERS }
    );
  }
}
