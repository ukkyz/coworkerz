import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ekDocuments, type ClearanceLevel } from "@/db/schema";
import {
  canPrincipalRead,
  resolveEnterprisePrincipal,
  reviewEnterpriseDocument,
} from "@/lib/enterprise-knowledge";

export const dynamic = "force-dynamic";

const HEADERS = {
  "X-Knowledge-Plane": "enterprise_knowledge",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, X-Simulate-Role",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await resolveEnterprisePrincipal(req);
    if (auth.error) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: HEADERS }
      );
    }
    const { id } = await context.params;
    const docId = Number(id);
    if (!docId) {
      return NextResponse.json(
        { error: "Invalid document id" },
        { status: 400, headers: HEADERS }
      );
    }

    const [doc] = await db
      .select()
      .from(ekDocuments)
      .where(eq(ekDocuments.id, docId))
      .limit(1);
    if (!doc) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404, headers: HEADERS }
      );
    }
    if (!canPrincipalRead(auth.principal, doc)) {
      return NextResponse.json(
        {
          error: `Access denied by Enterprise ACL for role ${auth.principal.role} (document requires ${doc.classificationLevel}).`,
        },
        { status: 403, headers: HEADERS }
      );
    }

    const { embedding: _emb, ...safeDoc } = doc;
    void _emb;
    return NextResponse.json(
      { plane: "enterprise_knowledge", document: safeDoc },
      { headers: HEADERS }
    );
  } catch (error) {
    console.error("GET /api/v1/enterprise/documents/[id] failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch document" },
      { status: 500, headers: HEADERS }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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
        { error: "Write/review permission required." },
        { status: 403, headers: HEADERS }
      );
    }

    const { id } = await context.params;
    const docId = Number(id);
    if (!docId) {
      return NextResponse.json(
        { error: "Invalid document id" },
        { status: 400, headers: HEADERS }
      );
    }

    const body = (await req.json()) as {
      reviewStatus?: "approved" | "pending_review" | "rejected";
      conceptIds?: string[];
      domainKey?: string;
      classificationLevel?: ClearanceLevel;
      aclReadRoles?: string[];
      reviewerNotes?: string;
    };

    const updated = await reviewEnterpriseDocument({
      documentId: docId,
      reviewStatus: body.reviewStatus,
      conceptIds: body.conceptIds,
      domainKey: body.domainKey,
      classificationLevel: body.classificationLevel,
      aclReadRoles: body.aclReadRoles,
      reviewerNotes: body.reviewerNotes,
      reviewedBy: auth.principal.role,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404, headers: HEADERS }
      );
    }

    const { embedding: _emb, ...safeDoc } = updated;
    void _emb;
    return NextResponse.json(
      { plane: "enterprise_knowledge", document: safeDoc },
      { headers: HEADERS }
    );
  } catch (error) {
    console.error("PATCH /api/v1/enterprise/documents/[id] failed:", error);
    return NextResponse.json(
      { error: "Failed to update/review document" },
      { status: 500, headers: HEADERS }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await resolveEnterprisePrincipal(req);
    if (auth.error) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: HEADERS }
      );
    }
    if (auth.principal.role !== "CEO" || !auth.principal.canWrite) {
      return NextResponse.json(
        { error: "Only CEO principal may permanently delete Enterprise KB documents." },
        { status: 403, headers: HEADERS }
      );
    }

    const { id } = await context.params;
    const docId = Number(id);
    if (!docId) {
      return NextResponse.json(
        { error: "Invalid document id" },
        { status: 400, headers: HEADERS }
      );
    }

    await db.delete(ekDocuments).where(eq(ekDocuments.id, docId));
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (error) {
    console.error("DELETE /api/v1/enterprise/documents/[id] failed:", error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500, headers: HEADERS }
    );
  }
}
