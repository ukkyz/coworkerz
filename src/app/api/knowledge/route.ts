import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeEntries } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const roleFilter = req.nextUrl.searchParams.get("role");
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

    const rows = await db
      .select()
      .from(knowledgeEntries)
      .orderBy(desc(knowledgeEntries.id))
      .limit(120);

    const filtered = rows.filter((item) => {
      if (roleFilter && roleFilter !== "ALL" && item.contributorRole !== roleFilter) {
        return false;
      }
      if (q) {
        const text = `${item.topic} ${item.insight} ${(item.tags || []).join(
          " "
        )}`.toLowerCase();
        return text.includes(q);
      }
      return true;
    });

    return NextResponse.json({ knowledge: filtered });
  } catch (error) {
    console.error("Failed to fetch knowledge entries:", error);
    return NextResponse.json(
      { error: "Failed to load enriched knowledge base" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      contributorRole?: string;
      topic?: string;
      insight?: string;
      category?: string;
      tags?: string[];
    };

    const topic = body.topic?.trim();
    const insight = body.insight?.trim();
    if (!topic || !insight) {
      return NextResponse.json(
        { error: "Both topic and insight are required" },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(knowledgeEntries)
      .values({
        contributorRole: body.contributorRole || "JOINT",
        collaboratorRole: "CEO",
        topic,
        insight,
        category: body.category || "cross-functional",
        confidenceScore: 97,
        tags: Array.isArray(body.tags) && body.tags.length > 0
          ? body.tags
          : ["ceo-mandate", "institutional-memory"],
        appliedCount: 0,
      })
      .returning();

    return NextResponse.json({ knowledgeEntry: created });
  } catch (error) {
    console.error("Failed to add knowledge entry:", error);
    return NextResponse.json(
      { error: "Failed to save knowledge entry" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "Valid id required" }, { status: 400 });
    }
    await db.delete(knowledgeEntries).where(eq(knowledgeEntries.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete knowledge entry:", error);
    return NextResponse.json(
      { error: "Failed to delete knowledge entry" },
      { status: 500 }
    );
  }
}
