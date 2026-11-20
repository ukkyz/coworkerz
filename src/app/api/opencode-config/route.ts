import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { executiveRoster, opencodeConfigs, type OpencodeConfig } from "@/db/schema";
import {
  getRoster,
  requireActive,
  validateModel,
  RosterError,
} from "@/lib/executive-profile-store";
import { isActive } from "@/lib/roster";
import { getActiveOpencodeConfig, publicOpencodeConfig } from "@/lib/opencode-config";
import { GatewaySettingsError, gatewayBase } from "@/lib/gateway-endpoints";
import { keyForSave, requestChatCompletion } from "@/lib/model-gateway";
import { requireCeoConsole } from "../executive-profiles/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

type Form = {
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  testModel?: string;
  models?: Record<string, unknown>;
  ctoModel?: unknown;
  cfoModel?: unknown;
  cooModel?: unknown;
  temperature?: string;
  walkTalkRounds?: number;
};

async function readForm(req: NextRequest, action: "test" | "save"): Promise<Form> {
  const common = ["baseUrl", "apiKey", "clearApiKey"];
  const allowed = common.concat(
    action === "test"
      ? ["testModel"]
      : ["models", "ctoModel", "cfoModel", "cooModel", "temperature", "walkTalkRounds"],
  );
  const body = !req.body && action === "test" ? {} : await req.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k)) ||
    ["baseUrl", "apiKey", "testModel"].some((k) => k in body && typeof body[k] !== "string") ||
    ("clearApiKey" in body && typeof body.clearApiKey !== "boolean")
  ) {
    throw new GatewaySettingsError(
      "Invalid gateway settings. Extra headers are server-configured.",
    );
  }
  if (
    "models" in body &&
    (!body.models || typeof body.models !== "object" || Array.isArray(body.models))
  ) {
    throw new GatewaySettingsError("Expected a map of executive IDs to model IDs.");
  }
  if (
    "temperature" in body &&
    (typeof body.temperature !== "string" ||
      !body.temperature.trim() ||
      !Number.isFinite(Number(body.temperature)))
  ) {
    throw new GatewaySettingsError("Invalid temperature.");
  }
  if ("walkTalkRounds" in body && !Number.isSafeInteger(body.walkTalkRounds))
    throw new GatewaySettingsError("Invalid round count.");
  return body;
}

function settingsResponse(config: OpencodeConfig) {
  const roster = getRoster();
  return NextResponse.json(
    {
      roster,
      config: {
        ...publicOpencodeConfig(config),
        models: Object.fromEntries(roster.filter(isActive).map((e) => [e.id, e.model])),
      },
    },
    { headers },
  );
}

function failure(error: unknown, fallback: string) {
  if (error instanceof GatewaySettingsError || error instanceof RosterError) {
    return NextResponse.json(
      { error: error.message },
      { status: error instanceof RosterError ? error.status : 400, headers },
    );
  }
  return NextResponse.json({ error: fallback }, { status: 500, headers });
}

export async function GET(req: NextRequest) {
  try {
    return (await requireCeoConsole(req)) ?? settingsResponse(getActiveOpencodeConfig());
  } catch (error) {
    return failure(error, "Failed to load OpenCode configuration.");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req);
    if (denied) return denied;
    const body = await readForm(req, "save");
    const updated = db.transaction(
      (tx) => {
        const current = getActiveOpencodeConfig(tx);
        const baseUrl = gatewayBase(body.baseUrl ?? current.baseUrl);
        const apiKey = keyForSave(current, baseUrl, body);
        const assignments = { ...body.models };
        const legacy: Partial<Pick<OpencodeConfig, "ctoModel" | "cfoModel" | "cooModel">> = {};
        for (const [id, key] of [
          ["CTO", "ctoModel"],
          ["CFO", "cfoModel"],
          ["COO", "cooModel"],
        ] as const) {
          if (body[key] !== undefined) assignments[id] ??= body[key];
          if (assignments[id] !== undefined) legacy[key] = validateModel(assignments[id]);
        }
        for (const [id, value] of Object.entries(assignments)) {
          const member = requireActive(id, tx);
          tx.update(executiveRoster)
            .set({ model: validateModel(value) })
            .where(eq(executiveRoster.id, member.id))
            .run();
        }
        return tx
          .update(opencodeConfigs)
          .set({
            ...legacy,
            baseUrl,
            apiKey,
            temperature: body.temperature?.trim() ?? current.temperature,
            walkTalkRounds: Math.min(6, Math.max(2, body.walkTalkRounds ?? current.walkTalkRounds)),
            updatedAt: new Date(),
          })
          .where(eq(opencodeConfigs.id, current.id))
          .returning()
          .get();
      },
      { behavior: "immediate" },
    );
    return settingsResponse(updated);
  } catch (error) {
    return failure(error, "Failed to save OpenCode configuration.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req);
    if (denied) return denied;
    const draft = await readForm(req, "test");
    const config = getActiveOpencodeConfig();
    const start = Date.now();
    const result = await requestChatCompletion({
      config,
      draft,
      model: draft.testModel ?? getRoster().find(isActive)?.model ?? config.ctoModel,
      messages: [{ role: "user", content: "Reply OK from the Coworkerz gateway diagnostic." }],
      maxTokens: 64,
      timeoutMs: 20_000,
    });
    const latencyMs = Date.now() - start;
    return NextResponse.json(
      {
        reachable: result.ok,
        mode: result.ok ? "opencode-live" : "opencode-local-runtime",
        latencyMs,
        message: result.ok
          ? `Received a chat completion from the selected gateway in ${latencyMs}ms.`
          : result.message,
        httpStatus: result.ok ? undefined : result.httpStatus,
      },
      { headers },
    );
  } catch (error) {
    return failure(error, "Failed to run the gateway diagnostic.");
  }
}
