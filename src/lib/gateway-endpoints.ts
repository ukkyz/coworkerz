export const CONSOLE_BASE = "https://opencode.ai/inference/openai/v1";
export const GO_BASE = "https://opencode.ai/inference/go/openai/v1";
export const OPENAI_BASE = "https://api.openai.com/v1";
export const GATEWAY_PRESETS = [
  { label: "Console", url: CONSOLE_BASE },
  { label: "Go", url: GO_BASE },
  { label: "Zen (legacy)", url: "https://opencode.ai/zen/v1" },
] as const;

export const isOpenCodePreset = (base: string | null) =>
  GATEWAY_PRESETS.some((p) => p.url === base);

// Examples from the published Chat Completions docs, not an entitlement check or a default.
export const OPENCODE_MODEL_EXAMPLES = ["kimi-k3", "glm-5.3", "minimax-m3"];

export function normalizeOpencodeModelId(model: string): string {
  // Display aliases never select a gateway. Preserve all other model namespaces.
  return model.trim().replace(/^opencode(?:-go)?\//i, "");
}

// Only messages from this error type are safe to display. Never include a key, raw URL,
// header value, or upstream response body in an error.
export class GatewaySettingsError extends Error {}

export function gatewayBase(value: unknown): string {
  const invalid = () =>
    new GatewaySettingsError(
      "Enter an absolute HTTPS gateway base URL without credentials, a query or a fragment (HTTP is allowed on loopback).",
    );
  if (
    typeof value !== "string" ||
    !/^https?:\/\//i.test(value.trim()) ||
    /[\s\\?#]/.test(value.trim())
  )
    throw invalid();
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid();
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.hostname.includes("*") ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  )
    throw invalid();
  const base = url.origin + url.pathname.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions"))
    throw new GatewaySettingsError("Enter the base URL, without /chat/completions.");
  return base;
}

export function validGatewayBase(value: unknown): string | null {
  try {
    return gatewayBase(value);
  } catch {
    return null;
  }
}

export function sameGateway(a: unknown, b: unknown): boolean {
  const base = validGatewayBase(a);
  return base !== null && base === validGatewayBase(b);
}

export const isOpenCode = (base: string) => new URL(base).origin === "https://opencode.ai";
