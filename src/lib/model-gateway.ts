import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { gatewayRequestState as state, type OpencodeConfig } from "@/db/schema";
import {
  CONSOLE_BASE,
  GO_BASE,
  OPENAI_BASE,
  validGatewayBase,
  isOpenCodePreset,
  GatewaySettingsError,
  gatewayBase,
  isOpenCode,
  normalizeOpencodeModelId,
  sameGateway,
} from "./gateway-endpoints";
import { readHeaderRules } from "./gateway-headers";
import { isSealed, seal, unseal } from "./secret-box";

/** Per-process token bucket. A multi-instance deployment points this at Redis. */
const providerBudget = (() => {
  const limit = Number(process.env.CW_PROVIDER_RATE_LIMIT ?? 30);
  return { limit: Number.isFinite(limit) && limit > 0 ? limit : 30, windowMs: 60_000, hits: [] as number[] };
})();

/** Refuse provider egress once the local budget for this minute is spent. */
export function providerEgressAllowed(now: number = Date.now()): boolean {
  providerBudget.hits = providerBudget.hits.filter((t) => now - t < providerBudget.windowMs);
  if (providerBudget.hits.length >= providerBudget.limit) return false;
  providerBudget.hits.push(now);
  return true;
}

/** Exported for tests only. */
export function resetProviderBudget() {
  providerBudget.hits = [];
}

type Settings = Pick<OpencodeConfig, "baseUrl" | "apiKey">;
type Draft = { baseUrl?: string; apiKey?: string; clearApiKey?: boolean };

// An explicitly entered key belongs to this destination. A saved key never follows a URL edit.
export function keyForSave(current: Settings, base: string, draft: Draft): string {
  if (draft.clearApiKey) return "";
  if (draft.apiKey !== undefined && typeof draft.apiKey !== "string")
    throw new GatewaySettingsError("Invalid API key field.");
  if (draft.apiKey !== undefined && draft.apiKey.trim()) {
    const entered = draft.apiKey.trim();
    validateBearer(entered);
    return seal(entered).sealed;
  }
  // A saved credential never follows a URL edit to a different destination.
  if (sameGateway(current.baseUrl, base)) return current.apiKey;
  return "";
}

function validateBearer(key: string) {
  if (key.length > 8192 || /[^\x21-\x7e]/.test(key)) {
    throw new GatewaySettingsError(
      "Enter just the API key, without a Bearer prefix, spaces or control characters.",
    );
  }
}

function envBearer(base: string): string {
  const pin = validGatewayBase(process.env.OPENCODE_BASE_URL?.trim() || CONSOLE_BASE);
  // OpenCode workspace keys can be used on its official plans. A custom env-pinned
  // key is for that exact base only. A general OpenAI key is not an OpenCode key.
  if (pin === base || (isOpenCodePreset(pin) && isOpenCodePreset(base))) {
    const key = process.env.OPENCODE_API_KEY?.trim();
    if (key) return key;
  }
  return base === OPENAI_BASE ? process.env.OPENAI_API_KEY?.trim() || "" : "";
}

/**
 * The credential for this base: a sealed row value first, then the deployment environment.
 * A legacy plaintext row is deliberately not returned; the migration cleared those and the
 * operator re-enters the key once.
 */
export function storedKey(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!stored.trim()) return "";
  return isSealed(stored) ? (unseal(stored, env) ?? "") : "";
}

export function publicKeyState(base: string | null, storedKeyValue: string) {
  const envHasApiKey = base !== null && Boolean(envBearer(base));
  const stored = Boolean(storedKey(storedKeyValue));
  return { hasApiKey: stored || envHasApiKey, maskedApiKey: stored ? "••••" : "", envHasApiKey };
}

async function requestState(base: string, numbered: boolean) {
  // The pure taxonomy/seed helpers also import the completion client. Do not open
  // an application DB at module load (or for offline/stateless completions).
  const { db } = await import("@/db");
  if (!numbered) {
    const existing = db.select().from(state).where(eq(state.baseUrl, base)).get();
    if (existing) return existing;
  }
  // One atomic allocation across processes. Network I/O never holds a SQLite lock.
  const increment = numbered ? 1 : 0;
  return db
    .insert(state)
    .values({ baseUrl: base, namespace: randomUUID(), lastSequence: increment })
    .onConflictDoUpdate({
      target: state.baseUrl,
      set: { lastSequence: sql`${state.lastSequence} + ${increment}` },
    })
    .returning()
    .get();
}

async function requestHeaders(base: string, key: string, sessionId?: number | null) {
  const rules = readHeaderRules(process.env.OPENCODE_HEADER_RULES, base);
  const numbered = rules.some((r) => r.type === "sequence");
  const openCode = isOpenCode(base);
  if (sessionId != null && (!Number.isSafeInteger(sessionId) || sessionId < 1))
    throw new GatewaySettingsError("Invalid boardroom session ID.");
  const saved =
    numbered || (openCode && sessionId != null) ? await requestState(base, numbered) : null;
  const headers = new Headers({
    "Content-Type": "application/json",
    "User-Agent": "coworkerz/1.0",
  });
  if (key) headers.set("Authorization", `Bearer ${key}`);
  if (openCode) {
    // Never send the local DB id or any conversation content. Standalone diagnostics,
    // classifications, etc. have no continuing conversation and get their own scope.
    const opaque =
      sessionId == null
        ? randomUUID().replaceAll("-", "")
        : createHash("sha256")
            .update(`${saved!.namespace}:${sessionId}`)
            .digest("hex")
            .slice(0, 32);
    headers.set("x-opencode-session", `ses_${opaque}`);
  }
  for (const rule of rules) {
    headers.set(rule.name, rule.type === "static" ? rule.value : rule.prefix + saved!.lastSequence);
  }
  return headers;
}

function httpFailure(status: number, base: string): string {
  const prefix = `Gateway returned HTTP ${status}. `;
  if (status >= 300 && status < 400)
    return prefix + "Redirect refused. Configure the final gateway base URL.";
  switch (status) {
    case 400:
    case 404:
      return prefix + "Check the base URL and the provider’s Chat Completions model ID.";
    case 401:
      return prefix + "Check the key for the selected gateway and workspace.";
    case 402:
      return prefix + "Check the workspace balance or subscription.";
    case 403:
      if (base === GO_BASE)
        return (
          prefix + "Check your Go subscription, model access and coding-agent workload eligibility."
        );
      if (isOpenCode(base))
        return (
          prefix +
          "Check workspace and model access. Console free-tier chat is restricted to the OpenCode client."
        );
      return prefix + "Check your provider’s permissions for this model.";
    case 429:
      return prefix + "A rate or usage limit was reached. Check the plan before retrying.";
    default:
      return prefix + "Check the selected provider’s status and settings.";
  }
}

type CompletionResult =
  { ok: true; content: string } | { ok: false; message: string; httpStatus?: number };
export async function requestChatCompletion(params: {
  config: Settings;
  draft?: Draft;
  sessionId?: number | null;
  model: string;
  messages: { role: "user" | "system"; content: string }[];
  maxTokens: number;
  temperature?: number;
  timeoutMs: number;
}): Promise<CompletionResult> {
  if (process.env.OPENCODE_OFFLINE === "1")
    return { ok: false, message: "Provider egress is disabled for this instance." };
  if (!providerEgressAllowed())
    return {
      ok: false,
      message: "The local provider budget for this minute is spent. Retry shortly.",
      httpStatus: 429,
    };
  let base: string, headers: Headers, model: string;
  try {
    base = gatewayBase(params.draft?.baseUrl ?? params.config.baseUrl);
    // A saved credential is pinned to the destination it was entered for. It must never
    // follow a URL edit to a different gateway.
    const saved =
      sameGateway(params.config.baseUrl, base) && !params.draft?.clearApiKey
        ? storedKey(params.config.apiKey)
        : "";
    const key = (params.draft?.apiKey?.trim() ?? "") || saved || envBearer(base);
    validateBearer(key);
    if (isOpenCode(base) && !key)
      throw new GatewaySettingsError(
        "Set a workspace API key for this OpenCode gateway. No live request was sent.",
      );
    model = normalizeOpencodeModelId(params.model);
    if (!model || model.length > 200 || /\s/.test(model))
      throw new GatewaySettingsError("Enter a valid Chat Completions model ID.");
    headers = await requestHeaders(base, key, params.sessionId);
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof GatewaySettingsError
          ? e.message
          : "Could not prepare the gateway request. Check server settings and database migrations.",
    };
  }
  const signal = AbortSignal.timeout(params.timeoutMs);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      redirect: "manual",
      cache: "no-store",
      signal,
      body: JSON.stringify({
        model,
        messages: params.messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ok: false,
        httpStatus: response.status,
        message: httpFailure(response.status, base),
      };
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim())
      return {
        ok: false,
        message:
          "The gateway returned no Chat Completions text. Check its URL, API format and model.",
      };
    return { ok: true, content: text.trim() };
  } catch (error) {
    if (error instanceof SyntaxError && !signal.aborted)
      return {
        ok: false,
        message: "The gateway did not return Chat Completions JSON. Check its URL and API format.",
      };
    return {
      ok: false,
      message: signal.aborted
        ? "The gateway request timed out."
        : "Could not reach the configured gateway. Check the server’s network access, TLS and base URL.",
    };
  }
}
