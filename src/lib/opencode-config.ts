import { asc } from "drizzle-orm";
import { db } from "@/db";
import { opencodeConfigs, type OpencodeConfig } from "@/db/schema";

export async function getActiveOpencodeConfig(): Promise<OpencodeConfig> {
  const [config] = await db.select().from(opencodeConfigs).orderBy(asc(opencodeConfigs.id)).limit(1);
  if (!config) throw new Error("OpenCode settings are missing. Run npm run db:setup before starting Coworkerz.");
  return config;
}
