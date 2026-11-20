import { NextRequest, NextResponse } from "next/server";
import {
  resolveEnterprisePrincipal,
  retrieveEnterpriseKnowledge,
} from "@/lib/enterprise-knowledge";

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
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    if (!q) {
      return NextResponse.json(
        { error: "Query parameter `q` is required." },
        { status: 400, headers: HEADERS }
      );
    }
    const domainsParam = req.nextUrl.searchParams.get("domains") ||
      req.nextUrl.searchParams.get("domain") || "";
    const domains = domainsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const topK = Number(req.nextUrl.searchParams.get("topK") || 5);
    const includeGraph = req.nextUrl.searchParams.get("includeGraph") !== "false";
    const includePendingReview =
      req.nextUrl.searchParams.get("includePending") === "true"
        ? true
        : req.nextUrl.searchParams.get("includePending") === "false"
        ? false
        : undefined;

    const result = await retrieveEnterpriseKnowledge({
      query: q,
      principal: auth.principal,
      domains,
      topK,
      includeGraph,
      includePendingReview,
      synthesizeAnswer: true,
    });

    return NextResponse.json(result, { headers: HEADERS });
  } catch (error) {
    console.error("GET /api/v1/enterprise/retrieve failed:", error);
    return NextResponse.json(
      { error: "Enterprise retrieval failed" },
      { status: 500, headers: HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      query?: string;
      domains?: string[];
      domain?: string;
      topK?: number;
      includePendingReview?: boolean;
      includeGraph?: boolean;
      graphHops?: number;
      synthesizeAnswer?: boolean;
      includeSeparateAgentMemory?: boolean;
      asRole?: string;
    };

    if ('asRole' in body && typeof body.asRole !== 'string') return NextResponse.json({error:'Invalid simulation identity.'}, {status:400,headers:HEADERS});
    const auth = await resolveEnterprisePrincipal(req, body.asRole);
    if (auth.error) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: HEADERS }
      );
    }

    const query = (body.query || "").trim();
    if (query.length < 2) {
      return NextResponse.json(
        { error: "A non-empty `query` string is required." },
        { status: 400, headers: HEADERS }
      );
    }

    const domains = Array.isArray(body.domains)
      ? body.domains
      : body.domain
      ? [body.domain]
      : [];

    const result = await retrieveEnterpriseKnowledge({
      query,
      principal: auth.principal,
      domains,
      topK: body.topK,
      includePendingReview: body.includePendingReview,
      includeGraph: body.includeGraph,
      graphHops: body.graphHops,
      synthesizeAnswer: body.synthesizeAnswer,
      includeSeparateAgentMemory: body.includeSeparateAgentMemory,
    });

    return NextResponse.json(result, { headers: HEADERS });
  } catch (error) {
    console.error("POST /api/v1/enterprise/retrieve failed:", error);
    return NextResponse.json(
      { error: "Enterprise knowledge retrieval failed" },
      { status: 500, headers: HEADERS }
    );
  }
}
