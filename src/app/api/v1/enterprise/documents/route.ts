import { NextRequest, NextResponse } from "next/server";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  ekDocuments,
  ekDomains,
  type ClearanceLevel,
  type EnterpriseDocMetadata,
} from "@/db/schema";
import {
  canPrincipalRead,
  ingestEnterpriseDocument,
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

    const domainFilter = req.nextUrl.searchParams.get("domain");
    const reviewFilter = req.nextUrl.searchParams.get("reviewStatus");
    const conceptFilter = req.nextUrl.searchParams.get("concept");

    const [domains, allDocs] = await Promise.all([
      db.select().from(ekDomains).orderBy(asc(ekDomains.id)),
      db.select().from(ekDocuments).orderBy(desc(ekDocuments.id)),
    ]);

    let aclRedacted = 0;
    const authorized = allDocs.filter((doc) => {
      if (!canPrincipalRead(auth.principal, doc)) {
        aclRedacted++;
        return false;
      }
      return true;
    });

    const filtered = authorized.filter((doc) => {
      if (domainFilter && domainFilter !== "ALL" && doc.domainKey !== domainFilter) {
        return false;
      }
      if (reviewFilter && reviewFilter !== "ALL" && doc.reviewStatus !== reviewFilter) {
        return false;
      }
      if (
        conceptFilter &&
        !(doc.taxonomyConcepts || []).some((t) => t.conceptId === conceptFilter)
      ) {
        return false;
      }
      return true;
    });

    // Omit raw 128-float embedding vector from list payload for fast wire transfer
    const sanitized = filtered.map(({ embedding: _emb, ...rest }) => {
      void _emb;
      return rest;
    });

    const counts = {
      totalAuthorized: authorized.length,
      approved: authorized.filter((d) => d.reviewStatus === "approved").length,
      pendingReview: authorized.filter((d) => d.reviewStatus === "pending_review")
        .length,
      rejected: authorized.filter((d) => d.reviewStatus === "rejected").length,
      aclRedacted,
    };

    return NextResponse.json(
      {
        plane: "enterprise_knowledge",
        principal: {
          role: auth.principal.role,
          clearance: auth.principal.clearance,
          allowedDomains: auth.principal.allowedDomains,
        },
        domains,
        counts,
        documents: sanitized,
      },
      { headers: HEADERS }
    );
  } catch (error) {
    console.error("GET /api/v1/enterprise/documents failed:", error);
    return NextResponse.json(
      { error: "Failed to load enterprise documents" },
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
        { error: "Principal does not hold write permission on Enterprise KB." },
        { status: 403, headers: HEADERS }
      );
    }

    const body = (await req.json()) as {
      title?: string;
      content?: string;
      docType?: string;
      domainKey?: string;
      classificationLevel?: ClearanceLevel;
      aclReadRoles?: string[];
      aclWriteRoles?: string[];
      metadata?: EnterpriseDocMetadata;
      autoApprove?: boolean;
      extractGraph?: boolean;
    };

    const title = (body.title || "").trim();
    const content = (body.content || "").trim();
    if (title.length < 3 || content.length < 15) {
      return NextResponse.json(
        { error: "`title` (>=3 chars) and `content` (>=15 chars) are required." },
        { status: 400, headers: HEADERS }
      );
    }

    const result = await ingestEnterpriseDocument({
      title,
      content,
      docType: body.docType,
      domainKey: body.domainKey,
      classificationLevel: body.classificationLevel,
      aclReadRoles: body.aclReadRoles,
      aclWriteRoles: body.aclWriteRoles,
      metadata: body.metadata,
      // Only CEO can bypass human review queue via autoApprove
      autoApprove: auth.principal.role === "CEO" && Boolean(body.autoApprove),
      extractGraph: body.extractGraph !== false,
    });

    const { embedding: _emb, ...docWithoutEmbedding } = result.document;
    void _emb;

    return NextResponse.json(
      {
        plane: "enterprise_knowledge",
        document: docWithoutEmbedding,
        chunkCount: result.chunkCount,
        createdEntities: result.createdEntities,
        createdRelationships: result.createdRelationships,
      },
      { status: 201, headers: HEADERS }
    );
  } catch (error) {
    console.error("POST /api/v1/enterprise/documents failed:", error);
    return NextResponse.json(
      { error: "Failed to ingest and auto-classify enterprise document" },
      { status: 500, headers: HEADERS }
    );
  }
}
