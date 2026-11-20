import { NextRequest, NextResponse } from "next/server";
import type { ClearanceLevel } from "@/db/schema";
import {
  createGraphEntity,
  createGraphRelationship,
  queryKnowledgeGraph,
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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    const sp = req.nextUrl.searchParams;
    const domain = sp.get("domain") || "ALL";
    const domainsParam = sp.get("domains") || "";
    const domains = domainsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const includeBridges = sp.get("includeBridges") !== "false";
    const onlyCrossDomain = sp.get("onlyCrossDomain") === "true";
    const seedQuery = sp.get("seed") || sp.get("q") || null;
    const hops = Number(sp.get("hops") || 2);

    const graph = await queryKnowledgeGraph({
      principal: auth.principal,
      domain,
      domains,
      includeCrossDomainBridges: includeBridges,
      onlyCrossDomain,
      seedQuery,
      hops,
    });

    return NextResponse.json(
      {
        plane: "enterprise_knowledge",
        principal: {
          role: auth.principal.role,
          clearance: auth.principal.clearance,
        },
        filter: {
          domain,
          domains,
          includeCrossDomainBridges: includeBridges,
          onlyCrossDomain,
          seedQuery,
          hops,
        },
        ...graph,
      },
      { headers: HEADERS }
    );
  } catch (error) {
    console.error("GET /api/v1/enterprise/graph failed:", error);
    return NextResponse.json(
      { error: "Failed to query Enterprise Knowledge Graph" },
      { status: 500, headers: HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveEnterprisePrincipal(req);
    if (auth.error) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: HEADERS }
      );
    }
    if (!auth.principal.canWrite) {
      return NextResponse.json(
        { error: "Principal does not hold Knowledge Graph write access." },
        { status: 403, headers: HEADERS }
      );
    }

    const body = (await req.json()) as
      | {
          kind: "entity";
          name?: string;
          entityType?: string;
          domainKey?: string;
          taxonomyConceptId?: string;
          description?: string;
          attributes?: Record<string, string>;
          classificationLevel?: ClearanceLevel;
          aclReadRoles?: string[];
        }
      | {
          kind: "relationship";
          sourceEntityId?: number;
          targetEntityId?: number;
          predicate?: string;
          domainKey?: string;
          evidence?: string;
          weight?: number;
          classificationLevel?: ClearanceLevel;
          aclReadRoles?: string[];
        };

    if (body.kind === "entity") {
      if (!body.name?.trim() || !body.domainKey?.trim()) {
        return NextResponse.json(
          { error: "`name` and `domainKey` are required for an entity." },
          { status: 400, headers: HEADERS }
        );
      }
      const entity = await createGraphEntity({
        name: body.name,
        entityType: body.entityType || "Initiative",
        domainKey: body.domainKey,
        taxonomyConceptId: body.taxonomyConceptId || null,
        description: body.description || body.name,
        attributes: body.attributes || {},
        classificationLevel: body.classificationLevel,
        aclReadRoles: body.aclReadRoles,
      });
      return NextResponse.json(
        { plane: "enterprise_knowledge", entity },
        { status: 201, headers: HEADERS }
      );
    }

    if (body.kind === "relationship") {
      const sId = Number(body.sourceEntityId);
      const tId = Number(body.targetEntityId);
      if (!sId || !tId || sId === tId || !body.predicate?.trim()) {
        return NextResponse.json(
          {
            error:
              "Distinct `sourceEntityId`, `targetEntityId`, and `predicate` are required.",
          },
          { status: 400, headers: HEADERS }
        );
      }
      const relationship = await createGraphRelationship({
        sourceEntityId: sId,
        targetEntityId: tId,
        predicate: body.predicate,
        domainKey: body.domainKey || "",
        evidence: body.evidence,
        weight: body.weight,
        classificationLevel: body.classificationLevel,
        aclReadRoles: body.aclReadRoles,
      });
      return NextResponse.json(
        { plane: "enterprise_knowledge", relationship },
        { status: 201, headers: HEADERS }
      );
    }

    return NextResponse.json(
      { error: "`kind` must be either `entity` or `relationship`." },
      { status: 400, headers: HEADERS }
    );
  } catch (error) {
    console.error("POST /api/v1/enterprise/graph failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to mutate graph",
      },
      { status: 500, headers: HEADERS }
    );
  }
}
