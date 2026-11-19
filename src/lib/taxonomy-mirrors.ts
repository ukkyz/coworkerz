import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EkTaxonomyScheme } from "@/db/schema";

/** These files are best-effort exports; only the version in SQLite is authoritative. */
export async function writeTaxonomyMirrors(scheme: Pick<EkTaxonomyScheme, "yamlContent" | "skosTurtle">) {
  const dir = process.env.KNOWLEDGE_DIR?.trim() || path.join(process.cwd(), "knowledge");
  try {
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    await Promise.all([
      writeFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, "taxonomy.skos.yaml"), scheme.yamlContent),
      writeFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, "taxonomy.skos.ttl"), scheme.skosTurtle),
    ]);
  } catch (error) {
    console.error("Failed to mirror the SQLite taxonomy:", error);
  }
}
