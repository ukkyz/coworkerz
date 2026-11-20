import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requireCeoConsole } from "../executive-profiles/access";
import { getRoster, requireActive, validateModel, RosterError } from "@/lib/executive-profile-store";
import { isActive } from "@/lib/roster";
import { executiveRoster, opencodeConfigs } from "@/db/schema";
import { getActiveOpencodeConfig } from "@/lib/opencode-config";
import { normalizeOpencodeModelId } from "@/lib/opencode";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (!key || key.trim().length === 0) return "";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req); if (denied) return denied;
    const config = await getActiveOpencodeConfig();
    const envHasApiKey = Boolean(
      process.env.OPENCODE_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim()
    );
    return NextResponse.json({
      roster: getRoster(),
      config: {
        models: Object.fromEntries(getRoster().filter(isActive).map(e => [e.id, e.model])),
        id: config.id,
        baseUrl: config.baseUrl,
        hasApiKey: Boolean(config.apiKey?.trim()) || envHasApiKey,
        maskedApiKey: maskKey(config.apiKey),
        envHasApiKey,
        ctoModel: config.ctoModel,
        cfoModel: config.cfoModel,
        cooModel: config.cooModel,
        temperature: config.temperature,
        walkTalkRounds: config.walkTalkRounds,
      },
    });
  } catch (error) {
    console.error("Failed to load OpenCode config:", error);
    return NextResponse.json(
      { error: "Failed to load OpenCode configuration" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req); if (denied) return denied;
    const current = await getActiveOpencodeConfig();
    const body = (await req.json()) as {
      baseUrl?: string;
      apiKey?: string;
      clearApiKey?: boolean;
      models?: Record<string, string>;
      ctoModel?: string;
      cfoModel?: string;
      cooModel?: string;
      temperature?: string;
      walkTalkRounds?: number;
    };

    const nextApiKey = body.clearApiKey
      ? ""
      : typeof body.apiKey === "string" && body.apiKey.trim().length > 0
      ? body.apiKey.trim()
      : current.apiKey;

    const rounds = Math.min(
      6,
      Math.max(2, Number(body.walkTalkRounds || current.walkTalkRounds || 4))
    );

    const updated = db.transaction(tx => {
      if (body.models !== undefined && (!body.models || typeof body.models !== 'object' || Array.isArray(body.models))) throw new RosterError('Expected a map of executive IDs to model IDs.');
      const assignments = {...body.models};
      const legacy: Partial<Pick<typeof current, 'ctoModel'|'cfoModel'|'cooModel'>> = {};
      for (const [id, key] of [['CTO','ctoModel'],['CFO','cfoModel'],['COO','cooModel']] as const) {
        if (body[key] !== undefined) assignments[id] ??= body[key];
        if (assignments[id] !== undefined) legacy[key] = validateModel(assignments[id]);
      }
      for (const [id, value] of Object.entries(assignments)) {
        const member = requireActive(id, tx);
        tx.update(executiveRoster).set({model:validateModel(value)}).where(eq(executiveRoster.id, member.id)).run();
      }
      return tx.update(opencodeConfigs).set({
        ...legacy, baseUrl: (body.baseUrl || current.baseUrl).trim(), apiKey: nextApiKey,
        temperature: (body.temperature || current.temperature).trim(), walkTalkRounds: rounds, updatedAt: new Date(),
      }).where(eq(opencodeConfigs.id,current.id)).returning().get();
    }, {behavior:'immediate'});

    const envHasApiKey = Boolean(
      process.env.OPENCODE_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim()
    );

    return NextResponse.json({
      roster: getRoster(),
      config: {
        models: Object.fromEntries(getRoster().filter(isActive).map(e => [e.id, e.model])),
        id: updated.id,
        baseUrl: updated.baseUrl,
        hasApiKey: Boolean(updated.apiKey?.trim()) || envHasApiKey,
        maskedApiKey: maskKey(updated.apiKey),
        envHasApiKey,
        ctoModel: updated.ctoModel,
        cfoModel: updated.cfoModel,
        cooModel: updated.cooModel,
        temperature: updated.temperature,
        walkTalkRounds: updated.walkTalkRounds,
      },
    });
  } catch (error) {
    if (error instanceof RosterError) return NextResponse.json({error:error.message}, {status:error.status});
    console.error("Failed to update OpenCode config:", error);
    return NextResponse.json(
      { error: "Failed to save OpenCode configuration" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requireCeoConsole(req); if (denied) return denied;
    const current = await getActiveOpencodeConfig();
    const body = (await req.json().catch(() => ({}))) as {
      baseUrl?: string;
      apiKey?: string;
      testModel?: string;
    };

    if (process.env.OPENCODE_OFFLINE === '1') return NextResponse.json({reachable:false,mode:'opencode-local-runtime',message:'Provider egress is disabled for this instance.'});
    const baseUrl = (body.baseUrl || current.baseUrl)
      .trim()
      .replace(/\/+$/, "");
    const apiKey =
      body.apiKey?.trim() ||
      current.apiKey?.trim() ||
      process.env.OPENCODE_API_KEY?.trim() ||
      "public";
    const testModel = normalizeOpencodeModelId(
      body.testModel || current.ctoModel
    );

    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: testModel,
          max_tokens: 24,
          messages: [
            {
              role: "user",
              content: "Reply OK from OpenCode Executive Gateway.",
            },
          ],
        }),
        signal: AbortSignal.timeout(6500),
      });

      const latencyMs = Date.now() - start;
      if (res.ok) {
        return NextResponse.json({
          reachable: true,
          mode: "opencode-live",
          latencyMs,
          message: `Connected live to OpenCode endpoint (${testModel}) in ${latencyMs}ms.`,
        });
      }

      return NextResponse.json({
        reachable: false,
        mode: "opencode-local-runtime",
        latencyMs,
        message: `Endpoint responded HTTP ${res.status}. Add a valid OpenCode Console API key for live cloud tokens; embedded OpenCode Synthesis Runtime is active and ready.`,
      });
    } catch {
      const latencyMs = Date.now() - start;
      return NextResponse.json({
        reachable: false,
        mode: "opencode-local-runtime",
        latencyMs,
        message:
          "Remote gateway unreachable or key not set — Embedded OpenCode Executive Runtime is active with zero-downtime synthesis & SQLite persistence.",
      });
    }
  } catch (error) {
    console.error("Error testing OpenCode connection:", error);
    return NextResponse.json(
      { error: "Failed to run OpenCode diagnostic" },
      { status: 500 }
    );
  }
}
