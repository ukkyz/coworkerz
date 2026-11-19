import { NextRequest, NextResponse } from "next/server";
import { getMemoryFileContent } from "@/lib/memory";

export const dynamic = "force-dynamic";

/** Serves a memory markdown file (regenerated fresh from SQLite, mirrored to memory/ on disk). */
export async function GET(req: NextRequest) {
  try {
    const rel = req.nextUrl.searchParams.get("path") || "CEO_PERSONA.md";
    const download = req.nextUrl.searchParams.get("download") === "1";
    const content = await getMemoryFileContent(rel);
    if (content === null) {
      return NextResponse.json({ error: "Memory file not found" }, { status: 404 });
    }
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
        ...(download
          ? { "Content-Disposition": `attachment; filename="${rel.split("/").pop()}"` }
          : {}),
      },
    });
  } catch (error) {
    console.error("Failed to read memory file:", error);
    return NextResponse.json({ error: "Failed to read memory file" }, { status: 500 });
  }
}
