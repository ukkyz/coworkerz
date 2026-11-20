import { GatewaySettingsError, gatewayBase } from "./gateway-endpoints";

export type HeaderRule =
  | { name: string; type: "static"; value: string }
  | { name: string; type: "sequence"; prefix: string };

const reserved = new Set([
  "authorization",
  "user-agent",
  "host",
  "accept",
  "accept-encoding",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "cookie",
  "set-cookie",
  "forwarded",
  "origin",
  "referer",
  "via",
]);
const printable = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max && !/[^\x20-\x7e]/.test(v);
function invalid(reason: string): never {
  throw new GatewaySettingsError(`Invalid OPENCODE_HEADER_RULES: ${reason}.`);
}

/** Operator-owned literal data, never a template language or a browser request header map. */
export function readHeaderRules(raw: string | undefined, target: string): HeaderRule[] {
  if (!raw?.trim()) return [];
  if (raw.length > 65536) invalid("configuration is too large");
  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch {
    invalid("expected a JSON object keyed by exact gateway base URL");
  }
  if (!config || typeof config !== "object" || Array.isArray(config))
    invalid("expected an object of gateway rules");
  const bases = new Set<string>();
  let result: HeaderRule[] = [];
  for (const [url, list] of Object.entries(config)) {
    const base = gatewayBase(url);
    if (bases.has(base)) invalid("duplicate base URL");
    bases.add(base);
    if (!Array.isArray(list) || list.length > 24)
      invalid("each base needs an array of at most 24 headers");
    const names = new Set<string>();
    const rules: HeaderRule[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        invalid("expected a header rule");
      const { name, type, value, prefix = "" } = entry;
      if (typeof name !== "string" || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(name))
        invalid("invalid header name");
      const lower = name.toLowerCase();
      if (
        names.has(lower) ||
        reserved.has(lower) ||
        /^(content-|proxy-|sec-|x-forwarded-|x-opencode-)/.test(lower)
      )
        invalid("reserved or duplicate header name");
      names.add(lower);
      if (!printable(prefix, 128) || prefix.trimStart() !== prefix)
        invalid("invalid literal prefix");
      if (type === "static") {
        if (!printable(value, 2048) || !value || value.trim() !== value)
          invalid("invalid static value");
        if (!value.startsWith(prefix)) invalid("static value does not match its required prefix");
        rules.push({ name: lower, type, value });
      } else if (type === "sequence") {
        if ("value" in entry) invalid("a sequence must not have a static value");
        rules.push({ name: lower, type, prefix });
      } else invalid("type must be static or sequence");
      if (Object.keys(entry).some((k) => !["name", "type", "value", "prefix"].includes(k)))
        invalid("unknown header rule field");
    }
    if (base === target) result = rules;
  }
  return result;
}
