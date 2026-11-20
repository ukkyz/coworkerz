import { validGatewayBase } from "./gateway-endpoints";
import { publicKeyState } from "./model-gateway";
import { asc } from "drizzle-orm";
import { db, type AppDatabase } from "@/db";
import { opencodeConfigs, type OpencodeConfig } from "@/db/schema";

export function getActiveOpencodeConfig(conn: AppDatabase = db): OpencodeConfig {
  const config = conn
    .select()
    .from(opencodeConfigs)
    .orderBy(asc(opencodeConfigs.id))
    .limit(1)
    .get();
  if (!config)
    throw new Error(
      "OpenCode settings are missing. Run npm run db:setup before starting Coworkerz.",
    );
  return config;
}

/** Console payloads expose key presence, never a raw key or deployment header values. */
export function publicOpencodeConfig(config: OpencodeConfig) {
  const { id, ctoModel, cfoModel, cooModel, temperature, walkTalkRounds } = config;
  // Old installations allowed credentials and query strings in the URL. Never echo an invalid URL.
  const base = validGatewayBase(config.baseUrl);
  return {
    id,
    baseUrl: base ?? "",
    ctoModel,
    cfoModel,
    cooModel,
    temperature,
    walkTalkRounds,
    ...publicKeyState(base, config.apiKey),
  };
}
