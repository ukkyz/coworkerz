import { NextRequest, NextResponse } from "next/server";
import { getActiveOpencodeConfig } from "@/lib/opencode-config";
import {
  getActiveTaxonomyScheme,
  resolveEnterprisePrincipal,
} from "@/lib/enterprise-knowledge";
import { autoClassifyDocument } from "@/lib/enterprise-taxonomy";

export const dynamic = "force-dynamic";

const HEADERS = {
  "X-Knowledge-Plane": "enterprise_knowledge",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, X-Simulate-Role",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
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

    const body = (await req.json()) as { title?: string; content?: string };
    const title = (body.title || "Untitled Document").trim();
    const content = (body.content || "").trim();
    if (content.length < 10) {
      return NextResponse.json(
        { error: "`content` (>=10 chars) is required to classify." },
        { status: 400, headers: HEADERS }
      );
    }

    const [scheme, config] = await Promise.all([
      getActiveTaxonomyScheme(),
      getActiveOpencodeConfig(),
    ]);

    const result = await autoClassifyDocument({
      title,
      content,
      concepts: scheme.parsedConcepts,
      config,
    });

    return NextResponse.json(
      {
        plane: "enterprise_knowledge",
        taxonomyVersion: scheme.version,
        schemeUri: scheme.schemeUri,
        requiresHumanReview: true,
        ...result,
      },
      { headers: HEADERS }
    );
  } catch (error) {
    console.error("POST /api/v1/enterprise/classify failed:", error);
    return NextResponse.json(
      { error: "Auto-classification failed" },
      { status: 500, headers: HEADERS }
    );
  }
}
