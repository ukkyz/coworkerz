import "./load-env";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { ekTaxonomySchemes, seedRuns } from "@/db/schema";
import { writeTaxonomyMirrors } from "@/lib/taxonomy-mirrors";
import { seedBoardroom } from "./seed/boardroom";
import { seedEnterprise } from "./seed/enterprise";

async function main() {
  // Keep the receipt and both datasets atomic, even if two setup jobs overlap.
  const applied = db.transaction((tx) => {
    const receipt = tx.insert(seedRuns).values({ name: "executive-suite-v1" })
      .onConflictDoNothing().returning().get();
    if (!receipt) return false;
    seedBoardroom(tx);
    seedEnterprise(tx);
    return true;
  }, { behavior: "immediate" });

  // Never reset an edited scheme to the demo version on a second run.
  const scheme = db.select().from(ekTaxonomySchemes).orderBy(desc(ekTaxonomySchemes.id)).limit(1).get();
  if (scheme) await writeTaxonomyMirrors(scheme);
  console.log(applied ? "Seeded the boardroom and enterprise knowledge." : "Seed already applied; existing data left intact.");
}

main().catch((error) => {
  console.error("SQLite seed failed. Apply migrations with npm run db:migrate first.", error);
  process.exitCode = 1;
}).finally(() => db.$client.close());
