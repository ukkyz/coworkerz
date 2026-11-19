import { promises as fs } from "fs";
import path from "path";
import { and, asc, count, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ceoPersona,
  conversationMessages,
  deliberationSessions,
  executiveMemories,
  knowledgeEntries,
  personaRevisions,
  type CeoPersona,
  type CeoPersonaProfile,
  type ConversationMessage,
  type KnowledgeEntry,
} from "@/db/schema";
import { isExecutiveRole, ExecutiveRole, ROOM_ZONES, RoomZoneId } from "./executives";
import { getExecutiveProfiles } from "./executive-profile-store";
import { getActiveOpencodeConfig } from "./opencode-config";
import { parseStructuredJson, tryLiveOpencodeCompletion } from "./opencode";

export const MEMORY_DIR =
  process.env.MEMORY_DIR?.trim() || path.join(process.cwd(), "memory");
const ROLES: ExecutiveRole[] = ["CTO", "CFO", "COO"];
type SessionRef = { id: number; ceoQuestion: string } | null;

// ---------- helpers ----------
function tag(role: string | null | undefined): string {
  if (!role || role === "ALL") return "the whole C-suite";
  if (role === "CEO") return "the CEO";
  // A durable memory should still identify the right participant after a rename.
  return isExecutiveRole(role) ? `the ${role}` : role;
}
const zoneLabel = (z: string) => ROOM_ZONES[z as RoomZoneId]?.label || z;
function clip(t: string, n: number): string {
  const s = (t || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
const fmt = (d: Date | string) =>
  `${new Date(d).toISOString().replace("T", " ").slice(0, 16)} UTC`;
const sessionFile = (id: number) => `session-${String(id).padStart(4, "0")}.md`;
const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ");

async function writeMemoryFile(rel: string, content: string): Promise<void> {
  try {
    const full = path.join(/*turbopackIgnore: true*/ MEMORY_DIR, rel);
    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(full), { recursive: true });
    await fs.writeFile(/*turbopackIgnore: true*/ full, content, "utf8");
  } catch (err) {
    console.error(`Memory file write failed (${rel}):`, err);
  }
}

// ---------- per-executive long-term memory ----------
export async function recordMessageMemories(
  msg: ConversationMessage,
  session: SessionRef
): Promise<void> {
  const base = {
    sessionId: msg.sessionId,
    sessionQuestion: session?.ceoQuestion || null,
    sourceMessageId: msg.id,
    createdAt: msg.createdAt,
  };
  const rows: Array<typeof executiveMemories.$inferInsert> = [];

  if (msg.senderRole === "CEO") {
    const type = msg.interactionMode === "ceo_followup" ? "ceo-followup" : "ceo-directive";
    for (const r of ROLES) {
      const content =
        msg.targetRole === "ALL"
          ? `The CEO asked all of us: "${msg.content}"`
          : msg.targetRole === r
          ? `The CEO asked me directly: "${msg.content}"`
          : `The CEO asked ${tag(msg.targetRole)}: "${msg.content}"`;
      rows.push({ ...base, executiveRole: r, memoryType: type, counterpartRole: "CEO", content });
    }
  } else {
    const speaker = msg.senderRole;
    const where = zoneLabel(msg.roomZone);
    for (const r of ROLES) {
      if (r === speaker) {
        rows.push({ ...base, executiveRole: r, memoryType: "said", counterpartRole: msg.targetRole,
          content: `At the ${where}, I told ${tag(msg.targetRole)}: "${msg.content}"` });
      } else if (r === msg.targetRole) {
        rows.push({ ...base, executiveRole: r, memoryType: "heard", counterpartRole: speaker,
          content: `${tag(speaker)} told me at the ${where}: "${msg.content}"` });
      } else {
        rows.push({ ...base, executiveRole: r, memoryType: "observed", counterpartRole: speaker,
          content: `I observed ${tag(speaker)} tell ${tag(msg.targetRole)} at the ${where}: "${msg.content}"` });
      }
    }
  }
  if (rows.length) await db.insert(executiveMemories).values(rows);
}

export async function recordLearnedMemory(
  entry: KnowledgeEntry,
  session: SessionRef
): Promise<void> {
  const roles =
    entry.contributorRole === "JOINT"
      ? ROLES
      : ROLES.filter((r) => r === entry.contributorRole);
  if (!roles.length) return;
  await db.insert(executiveMemories).values(
    roles.map((r) => ({
      executiveRole: r,
      sessionId: entry.sessionId,
      sessionQuestion: session?.ceoQuestion || null,
      sourceMessageId: entry.sourceMessageId,
      memoryType: "learned",
      counterpartRole: entry.collaboratorRole,
      content: `I learned "${entry.topic}" — ${entry.insight}`,
      createdAt: entry.createdAt,
    }))
  );
}

let backfillPromise: Promise<boolean> | null = null;
let backfillSettled = false;
/** Backfills memories for conversations stored before the memory engine existed. Returns true only to the call(s) that triggered it. */
export function ensureMemoryBackfill(): Promise<boolean> {
  if (backfillSettled) return Promise.resolve(false);
  if (!backfillPromise) {
    backfillPromise = (async () => {
      const [{ stored }] = await db
        .select({ stored: count() })
        .from(executiveMemories);
      if (stored > 0) return false;
      const sessions = await db.select().from(deliberationSessions);
      const q = new Map(sessions.map((s) => [s.id, s.ceoQuestion]));
      const msgs = await db.select().from(conversationMessages).orderBy(asc(conversationMessages.id));
      for (const m of msgs) {
        await recordMessageMemories(m, { id: m.sessionId, ceoQuestion: q.get(m.sessionId) || "" });
      }
      const know = await db.select().from(knowledgeEntries).orderBy(asc(knowledgeEntries.id));
      for (const k of know) {
        await recordLearnedMemory(k, k.sessionId ? { id: k.sessionId, ceoQuestion: q.get(k.sessionId) || "" } : null);
      }
      return msgs.length > 0;
    })()
      .then((ran) => {
        backfillSettled = true;
        return ran;
      })
      .catch((err) => {
      backfillPromise = null;
      throw err;
    });
  }
  return backfillPromise;
}

/** Synchronously persists every executive's memory of a freshly saved message (+ learned knowledge). */
export async function persistMemoriesFor(params: {
  message: ConversationMessage;
  knowledge?: KnowledgeEntry | null;
  session: SessionRef;
}): Promise<void> {
  const didBackfill = await ensureMemoryBackfill();
  if (didBackfill) return; // backfill already covered rows that were just inserted
  await recordMessageMemories(params.message, params.session);
  if (params.knowledge) await recordLearnedMemory(params.knowledge, params.session);
}

export async function getExecutiveRecall(
  role: ExecutiveRole,
  excludeSessionId: number,
  limit = 6
): Promise<string[]> {
  const rows = await db
    .select()
    .from(executiveMemories)
    .where(
      and(
        eq(executiveMemories.executiveRole, role),
        ne(executiveMemories.memoryType, "observed"),
        or(isNull(executiveMemories.sessionId), ne(executiveMemories.sessionId, excludeSessionId))
      )
    )
    .orderBy(desc(executiveMemories.id))
    .limit(limit);
  return rows.map((r) => `[${r.sessionId ? `Session #${r.sessionId}` : "Archived"}] ${clip(r.content, 220)}`);
}

// ---------- CEO persona analysis ----------
const SKILL_LEXICON: Array<{ name: string; priority: string; re: RegExp }> = [
  { name: "AI & Technology Strategy", priority: "AI, cloud & platform architecture bets",
    re: /\b(ai|gpu|cloud|inference|models?|llm|clusters?|architecture|platform|latency|tokens?|agents?|autonomous|security|zero-trust|data|software|tech\w*)\b/gi },
  { name: "Capital Allocation & Financial Acumen", priority: "Capital efficiency, margins & ROI",
    re: /(\$[\d.,]+\s*[mbk]?|\b(ebitda|margins?|arr|revenue|budget|capital|roi|payback|cash|valuation|costs?|equity|invest\w*|financ\w*|profit\w*)\b)/gi },
  { name: "Operational Execution & Scaling", priority: "Execution speed, SLAs & operating cadence",
    re: /\b(execution|execute|rollout|onboarding|sla|operations?|operational|headcount|hiring|supply|vendors?|process\w*|delivery|timeline|\d+-day|turnaround)\b/gi },
  { name: "M&A & Corporate Development", priority: "Inorganic growth & post-merger integration",
    re: /\b(acqui\w*|mergers?|m&a|startups?|buyouts?|deals?|diligence|post-merger)\b/gi },
  { name: "Go-To-Market & Global Expansion", priority: "Market expansion & enterprise sales",
    re: /\b(europe\w*|global\w*|regions?|regional|markets?|expansion|expand\w*|sales|gtm|go-to-market|international)\b/gi },
  { name: "Customer Retention & Growth", priority: "Customer retention & net revenue growth",
    re: /\b(churn|retention|nrr|upsell|customers?|loyalty|adoption)\b/gi },
  { name: "Risk Management & Governance", priority: "Risk, compliance & governance",
    re: /\b(risks?|compliance|gdpr|dora|regulat\w*|governance|audit|downside|cannibaliz\w*|sovereign\w*)\b/gi },
  { name: "Product & Pricing Innovation", priority: "Product strategy & monetization",
    re: /\b(pricing|products?|tiers?|outcome-based|monetiz\w*|bundles?|seats?|seat-based|features?)\b/gi },
];

const THEME_STOP = new Set(
  "should would could about their there where which while without within through these those other first every under over into from with this that what when they them have will your ours walk talk align plan need want enterprise company question quarter".split(" ")
);

const ratio = (texts: string[], re: RegExp) =>
  texts.length ? texts.filter((t) => re.test(t)).length / texts.length : 0;
const listJoin = (a: string[]) =>
  a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

async function analyzePersona(): Promise<{ profile: CeoPersonaProfile; ceoTexts: string[] }> {
  const all = await db.select().from(conversationMessages).orderBy(asc(conversationMessages.id));
  const ceo = all.filter((m) => m.senderRole === "CEO");
  const bots = all.filter((m) => m.senderRole !== "CEO");
  const texts = ceo.map((m) => m.content);
  const n = texts.length;
  const [{ sessions }] = await db.select({ sessions: count() }).from(deliberationSessions);
  const [{ know }] = await db.select({ know: count() }).from(knowledgeEntries);
  const followUps = ceo.filter((m) => m.interactionMode === "ceo_followup");
  const consensus = bots.filter((m) => m.interactionMode === "executive_consensus").length;
  const botToBot = bots.filter((m) => m.targetRole !== "CEO" && m.targetRole !== "ALL").length;

  const skillHits: Record<string, number> = {};
  const skills = SKILL_LEXICON.map((s) => {
    let hits = 0;
    let msgsWith = 0;
    let last = "";
    for (const t of texts) {
      const h = (t.match(s.re) || []).length;
      if (h > 0) {
        hits += h;
        msgsWith += 1;
        last = t;
      }
    }
    skillHits[s.name] = hits;
    return { name: s.name, priority: s.priority, hits, msgsWith, last };
  })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const quant = ratio(texts, /(\$|\d+%|\b\d+(\.\d+)?\s?(m|b|k|million|billion)\b)/i);
  const timeBox = ratio(texts, /(\d+[- ]?(day|week|month|quarter|year)s?|\bq[1-4]\b|this quarter|deadline|immediate\w*)/i);
  const tradeoff = ratio(texts, /\b(or|vs\.?|versus|without|while|tradeoffs?|instead)\b/i);
  const risk = ratio(texts, /\b(risks?|downside|cannibaliz\w*|protect\w*|guardrails?|compliance)\b/i);
  const growth = ratio(texts, /\b(expand\w*|accelerat\w*|scal\w*|growth|grow|capture|win)\b/i);
  const collab = ratio(texts, /\b(align|walk and talk|together|team|consensus|cross-functional)\b/i);
  const questions = ratio(texts, /(\?\s*$|^(should|how|what|why|can|could|would|which|when|do|does|is|are)\b)/i);
  const avgWords = n ? Math.round(texts.reduce((a, t) => a + t.split(/\s+/).length, 0) / n) : 0;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const decisionStyle: string[] = [];
  if (quant >= 0.3) decisionStyle.push(`Data-driven: anchors ${pct(quant)} of directives in explicit numbers (budgets, percentages, ARR).`);
  if (timeBox >= 0.3) decisionStyle.push("Time-boxed operator: frames decisions against concrete horizons (quarters, 60/90-day windows).");
  if (tradeoff >= 0.3) decisionStyle.push("Tradeoff thinker: poses either/or choices and expects alternatives weighed explicitly.");
  if (risk >= 0.3) decisionStyle.push("Risk-aware: probes downside, cannibalization and compliance exposure before committing.");
  if (growth >= 0.3) decisionStyle.push("Growth-oriented: consistently pushes for expansion, acceleration and scale.");
  if (collab >= 0.3) decisionStyle.push("Consensus builder: deliberately routes decisions through cross-functional alignment.");
  if (followUps.length > 0) decisionStyle.push(`Hands-on interrogator: follows up directly with individual executives (${followUps.length} direct follow-up${followUps.length > 1 ? "s" : ""}).`);
  if (!decisionStyle.length) decisionStyle.push("Emerging profile — more directives are needed to characterize decision style.");

  const commLabel = avgWords < 18 ? "Crisp & concise directives" : avgWords < 40 ? "Structured executive briefs" : "Detailed, context-rich directives";
  const styleHint = `${commLabel.toLowerCase()} with ${quant >= 0.5 ? "quantified" : "clearly reasoned"}${timeBox >= 0.3 ? ", time-boxed" : ""} recommendations`;

  const money = Array.from(new Set(texts.flatMap((t) => t.match(/\$[\d.,]+\s*[MBKmbk]?/g) || []))).slice(0, 4);
  const horizons = Array.from(new Set(texts.flatMap((t) => t.match(/\b(\d+[- ](day|week|month)s?|this quarter|Q[1-4])\b/gi) || []))).slice(0, 3);
  const directTo = (r: ExecutiveRole) => followUps.filter((m) => m.targetRole === r);
  const directNote = (r: ExecutiveRole) => {
    const d = directTo(r);
    return d.length ? [`Asked me directly ${d.length} time(s); latest: "${clip(d[d.length - 1].content, 110)}".`] : [];
  };
  const techHits = skillHits["AI & Technology Strategy"] || 0;
  const finHits = skillHits["Capital Allocation & Financial Acumen"] || 0;
  const opsHits = skillHits["Operational Execution & Scaling"] || 0;

  const executiveObservations: CeoPersonaProfile["executiveObservations"] = {
    CTO: [
      techHits > 0
        ? `Raised technology/AI topics ${techHits} time(s); expects modular, reversible architecture with measurable latency, security and integration gates.`
        : "Has not pushed deeply on technology yet — I proactively surface architecture risks.",
      ...(quant >= 0.5 ? ["Responds best when I translate technical options into cost, latency and timeline numbers."] : []),
      ...directNote("CTO"),
    ],
    CFO: [
      money.length
        ? `Frames decisions with explicit capital figures (${money.join(", ")}); expects payback, margin and downside scenarios.`
        : finHits > 0
        ? `Raises financial considerations ${finHits} time(s); wants ROI framing on every option.`
        : "Rarely states budgets explicitly — I anchor each option to a capital envelope and payback window.",
      ...(risk >= 0.3 ? ["Values downside protection and staged, tranche-based commitments."] : []),
      ...directNote("CFO"),
    ],
    COO: [
      horizons.length
        ? `Thinks in execution horizons (${horizons.join(", ")}); expects owners, milestones and SLA checkpoints.`
        : opsHits > 0
        ? `Raises execution topics ${opsHits} time(s); wants clear owners and operating cadence.`
        : "Delegates execution detail — I convert strategy into 30/60/90-day plans proactively.",
      ...(growth >= 0.3 ? ["Pushes for expansion; I sequence rollout to protect delivery quality."] : []),
      ...directNote("COO"),
    ],
  };

  const freq = new Map<string, number>();
  for (const t of texts) {
    for (const w of t.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/)) {
      if (w.length >= 5 && !THEME_STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const recurringThemes = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);

  const top = skills.slice(0, 3).map((s) => s.name);
  const trait = quant >= 0.5 ? "data-driven" : growth >= 0.3 ? "growth-focused" : risk >= 0.3 ? "risk-conscious" : "strategic";
  const decisionPhrase = quant >= 0.5 ? "anchors decisions in hard numbers" : tradeoff >= 0.3 ? "frames decisions as explicit tradeoffs" : "sets direction and delegates analysis";
  const p0 = skills[0]?.priority || "Balanced enterprise outcomes";
  const priorityPhrase = /^[A-Z]{2,}/.test(p0) ? p0 : `${p0.charAt(0).toLowerCase()}${p0.slice(1)}`;
  const executiveSummary = n === 0
    ? "No CEO directives recorded yet. Ask your C-suite a strategic question to start building your persona memory."
    : `A ${trait} chief executive whose strongest demonstrated competencies are ${listJoin(top)}. Across ${n} message${n > 1 ? "s" : ""} in ${sessions} boardroom session${sessions === 1 ? "" : "s"}, the CEO ${decisionPhrase}, communicates through ${commLabel.toLowerCase()}, and steers the C-suite toward ${priorityPhrase}.`;

  const profile: CeoPersonaProfile = {
    executiveSummary,
    skills: skills.map((s) => ({
      name: s.name,
      score: Math.min(98, Math.round(38 + s.hits * 6 + s.msgsWith * 7)),
      evidenceCount: s.hits,
      lastEvidence: clip(s.last, 120),
    })),
    decisionStyle,
    communicationStyle: {
      label: commLabel,
      avgWords,
      questionRatio: Math.round(questions * 100) / 100,
      quantitativeRatio: Math.round(quant * 100) / 100,
      notes: [
        `Prefers ${quant >= 0.5 ? "quantified answers with hard numbers" : "clear strategic reasoning over raw numbers"}.`,
        `Addresses ${followUps.length ? "both the full C-suite and individual executives" : "the full C-suite as a unit"}.`,
        `Typical message length: ~${avgWords} words; ${pct(questions)} phrased as questions.`,
      ],
    },
    styleHint,
    strategicPriorities: skills.slice(0, 5).map((s) => ({ theme: s.priority, mentions: s.hits })),
    recurringThemes,
    executiveObservations,
    recentDirectives: ceo.slice(-8).reverse().map((m) => ({
      sessionId: m.sessionId,
      content: clip(m.content, 220),
      targetRole: m.targetRole,
      createdAt: new Date(m.createdAt).toISOString(),
    })),
    stats: {
      totalCeoMessages: n,
      totalSessions: sessions,
      totalBotMessages: bots.length,
      botToBotExchanges: botToBot,
      directFollowUps: followUps.length,
      consensusBriefings: consensus,
      knowledgeEntries: know,
    },
  };
  return { profile, ceoTexts: texts };
}

async function refineWithOpencode(
  profile: CeoPersonaProfile,
  ceoTexts: string[]
): Promise<{ profile: CeoPersonaProfile; mode: string }> {
  if (!ceoTexts.length) return { profile, mode: "opencode-local-runtime" };
  try {
    const config = await getActiveOpencodeConfig();
    const raw = await tryLiveOpencodeCompletion({
      config,
      modelDisplayId: config.cooModel,
      maxTokens: 700,
      systemPrompt:
        'You are the joint memory of a CTO, CFO and COO. Profile the CEO you work for from their own messages. Respond ONLY with JSON: {"executiveSummary":"2-3 sentences","decisionStyle":["..."],"observations":{"CTO":["..."],"CFO":["..."],"COO":["..."]}}',
      userPrompt: `CEO MESSAGES (oldest first):\n${ceoTexts.slice(-25).map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nHEURISTIC PROFILE:\n${JSON.stringify({ skills: profile.skills.map((s) => `${s.name} ${s.score}`), decisionStyle: profile.decisionStyle })}`,
    });
    const parsed = raw
      ? parseStructuredJson<{ executiveSummary?: string; decisionStyle?: unknown[]; observations?: Record<string, unknown[]> }>(raw)
      : null;
    if (!parsed?.executiveSummary || parsed.executiveSummary.length < 40) {
      return { profile, mode: "opencode-local-runtime" };
    }
    const strs = (a: unknown) => (Array.isArray(a) ? a.map(String).filter((s) => s.length > 5) : []);
    const merged: CeoPersonaProfile = {
      ...profile,
      executiveSummary: parsed.executiveSummary.trim(),
      decisionStyle: [...strs(parsed.decisionStyle).slice(0, 3), ...profile.decisionStyle].slice(0, 7),
      executiveObservations: {
        CTO: [...strs(parsed.observations?.CTO).slice(0, 2), ...profile.executiveObservations.CTO],
        CFO: [...strs(parsed.observations?.CFO).slice(0, 2), ...profile.executiveObservations.CFO],
        COO: [...strs(parsed.observations?.COO).slice(0, 2), ...profile.executiveObservations.COO],
      },
      aiRefined: true,
    };
    return { profile: merged, mode: "opencode-live" };
  } catch {
    return { profile, mode: "opencode-local-runtime" };
  }
}

function renderPersonaMarkdown(p: CeoPersonaProfile, version: number, at: Date): string {
  const profiles = getExecutiveProfiles();
  const bar = (s: number) => `${"█".repeat(Math.round(s / 10))}${"░".repeat(10 - Math.round(s / 10))}`;
  const lines: string[] = [
    "# CEO Persona & Skills Profile",
    "",
    `> Living memory file maintained automatically by your AI C-suite — ${profiles.CTO.displayName} (CTO), ${profiles.CFO.displayName} (CFO) and ${profiles.COO.displayName} (COO).`,
    `> Version **v${version}** · Updated ${fmt(at)} · Analyzed ${p.stats.totalCeoMessages} CEO message(s) across ${p.stats.totalSessions} session(s)${p.aiRefined ? " · AI-refined via OpenCode" : ""}.`,
    "",
    "## Executive Summary",
    "",
    p.executiveSummary,
    "",
    "## Core Skills & Demonstrated Competencies",
    "",
    "| Skill | Proficiency | Evidence |",
    "|---|---|---|",
    ...(p.skills.length
      ? p.skills.map((s) => `| ${s.name} | \`${bar(s.score)}\` ${s.score}/100 | ${s.evidenceCount} signal(s) — "${cell(clip(s.lastEvidence, 90))}" |`)
      : ["| _No skills detected yet_ | — | — |"]),
    "",
    "## Leadership & Decision Style",
    "",
    ...p.decisionStyle.map((d) => `- ${d}`),
    "",
    "## Communication Preferences",
    "",
    `- **Style:** ${p.communicationStyle.label} (avg ${p.communicationStyle.avgWords} words)`,
    `- **Quantitative framing:** ${Math.round(p.communicationStyle.quantitativeRatio * 100)}% of messages include hard numbers`,
    `- **How the C-suite should respond:** ${p.styleHint}`,
    ...p.communicationStyle.notes.map((n) => `- ${n}`),
    "",
    "## Strategic Priorities",
    "",
    ...(p.strategicPriorities.length
      ? p.strategicPriorities.map((s, i) => `${i + 1}. **${s.theme}** — ${s.mentions} mention(s)`)
      : ["_Not enough signal yet._"]),
    "",
    "## Recurring Themes",
    "",
    p.recurringThemes.length ? p.recurringThemes.map((t) => `\`${t}\``).join(" · ") : "_None yet._",
    "",
    "## What Your C-Suite Has Learned About You",
    "",
  ];
  for (const r of ROLES) {
    lines.push(`### ${profiles[r].displayName} — ${r}`, "", ...p.executiveObservations[r].map((o) => `- ${o}`), "");
  }
  lines.push(
    "## Recent CEO Directives",
    "",
    ...(p.recentDirectives.length
      ? p.recentDirectives.map((d) => `- **Session #${d.sessionId} → ${d.targetRole}** (${fmt(d.createdAt)}): "${d.content}"`)
      : ["_No directives yet._"]),
    "",
    "## Memory Statistics",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| CEO messages | ${p.stats.totalCeoMessages} |`,
    `| Direct follow-ups to individual executives | ${p.stats.directFollowUps} |`,
    `| Executive messages | ${p.stats.totalBotMessages} |`,
    `| Bot-to-bot walk & talk exchanges | ${p.stats.botToBotExchanges} |`,
    `| Joint consensus briefings | ${p.stats.consensusBriefings} |`,
    `| Enriched knowledge entries | ${p.stats.knowledgeEntries} |`,
    "",
    "---",
    "_Auto-generated by the Aether 3D Executive Suite memory engine. Source of truth: SQLite (`ceo_persona`, `conversation_messages`, `executive_memories`)._",
    ""
  );
  return lines.join("\n");
}

function summarizeChange(prev: CeoPersonaProfile | null | undefined, next: CeoPersonaProfile, trigger: string): string {
  const labels: Record<string, string> = {
    initial: "Initial persona synthesized",
    ceo_directive: "New CEO directive analyzed",
    ceo_followup: "CEO follow-up analyzed",
    ceo_response: "Executive answer to CEO reviewed",
    consensus: "C-suite consensus reviewed",
    manual_rebuild: "Full memory rebuild",
  };
  const parts = [labels[trigger] || trigger];
  if (!prev) {
    parts.push(`${next.skills.length} skill(s) profiled`);
  } else {
    const before = new Map(prev.skills.map((s) => [s.name, s.score]));
    for (const s of next.skills) {
      const p = before.get(s.name);
      if (p === undefined) parts.push(`new skill: ${s.name} (${s.score})`);
      else if (p !== s.score) parts.push(`${s.name} ${p}→${s.score}`);
    }
    const delta = next.stats.totalCeoMessages - prev.stats.totalCeoMessages;
    if (delta > 0) parts.push(`+${delta} CEO message(s)`);
  }
  return parts.slice(0, 5).join(" · ");
}

let personaChain: Promise<unknown> = Promise.resolve();
/** Serialized persona update: re-analyzes all CEO conversations, versions CEO_PERSONA.md and refreshes journals. */
export function updatePersona(trigger: string, sessionId: number | null = null): Promise<CeoPersona | null> {
  const run = personaChain.then(async () => {
    await ensureMemoryBackfill();
    const analysis = await analyzePersona();
    const refined = await refineWithOpencode(analysis.profile, analysis.ceoTexts);
    const profile = refined.profile;
    const [existing] = await db.select().from(ceoPersona).orderBy(asc(ceoPersona.id)).limit(1);
    let row: CeoPersona | undefined = existing;
    const changed = !existing || trigger === "manual_rebuild" || JSON.stringify(existing.profile) !== JSON.stringify(profile);
    if (changed) {
      const version = (existing?.version || 0) + 1;
      const now = new Date();
      const markdown = renderPersonaMarkdown(profile, version, now);
      const values = {
        version,
        markdown,
        profile,
        analyzedMessageCount: profile.stats.totalCeoMessages,
        providerMode: refined.mode,
        updatedAt: now,
      };
      [row] = existing
        ? await db.update(ceoPersona).set(values).where(eq(ceoPersona.id, existing.id)).returning()
        : await db.insert(ceoPersona).values(values).returning();
      await db.insert(personaRevisions).values({
        version,
        changeSummary: summarizeChange(existing?.profile, profile, trigger),
        triggerEvent: trigger,
        sessionId,
        markdown,
      });
    }
    if (row) await writeMemoryFile("CEO_PERSONA.md", row.markdown);
    await Promise.all([...ROLES.map((r) => syncExecutiveJournal(r)), syncIndexFile()]);
    return row ?? null;
  });
  personaChain = run.catch(() => null);
  return run;
}

export async function getOrCreatePersona(): Promise<CeoPersona | null> {
  const [row] = await db.select().from(ceoPersona).orderBy(asc(ceoPersona.id)).limit(1);
  return row ?? (await updatePersona("initial"));
}

export async function getPersonaContext(): Promise<{ brief: string; styleHint: string }> {
  const [row] = await db.select().from(ceoPersona).orderBy(asc(ceoPersona.id)).limit(1);
  const p = row?.profile;
  if (!p) return { brief: "", styleHint: "" };
  return {
    styleHint: p.styleHint,
    brief: [
      `CEO persona v${row.version}: ${p.executiveSummary}`,
      `Top skills: ${p.skills.slice(0, 4).map((s) => `${s.name} (${s.score})`).join(", ") || "n/a"}.`,
      `Decision style: ${p.decisionStyle.slice(0, 3).map((d) => clip(d, 90)).join(" | ")}`,
      `Respond with: ${p.styleHint}.`,
      `Priorities: ${p.strategicPriorities.slice(0, 3).map((s) => s.theme).join("; ") || "n/a"}.`,
    ].join("\n"),
  };
}

// ---------- markdown mirrors ----------
export async function syncSessionTranscript(sessionId: number): Promise<string | null> {
  const rel = `conversations/${sessionFile(sessionId)}`;
  const [session] = await db.select().from(deliberationSessions).where(eq(deliberationSessions.id, sessionId)).limit(1);
  if (!session) {
    try {
      return await fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ MEMORY_DIR, rel), "utf8");
    } catch {
      return null;
    }
  }
  const msgs = await db.select().from(conversationMessages).where(eq(conversationMessages.sessionId, sessionId)).orderBy(asc(conversationMessages.id));
  const know = await db.select().from(knowledgeEntries).where(eq(knowledgeEntries.sessionId, sessionId)).orderBy(asc(knowledgeEntries.id));
  const profiles = getExecutiveProfiles();
  const who = (r: string) => (r === "CEO" ? "CEO (You)" : isExecutiveRole(r) ? `${profiles[r].displayName} (${r})` : r);
  const md = [
    `# Session #${session.id} — Boardroom Conversation Transcript`,
    "",
    `- **CEO question:** ${session.ceoQuestion}`,
    `- **Status:** ${session.status} · **Executive turns:** ${session.turnCount} · **Started:** ${fmt(session.createdAt)} · **Updated:** ${fmt(session.updatedAt)}`,
    "",
    ...(session.executiveSummary ? ["## Latest C-Suite Consensus", "", `> ${session.executiveSummary}`, ""] : []),
    "## Full Conversation",
    "",
    ...msgs.flatMap((m, i) => [
      `### ${i + 1}. ${who(m.senderRole)} → ${who(m.targetRole === "ALL" ? "ALL" : m.targetRole)}`,
      `_${m.interactionMode.replace(/_/g, " ")} · ${zoneLabel(m.roomZone)} · ${fmt(m.createdAt)}${m.senderRole === "CEO" ? "" : ` · ${m.modelUsed} (${m.providerMode})`}_`,
      "",
      `> ${m.content}`,
      "",
    ]),
    "## Knowledge Enriched In This Session",
    "",
    ...(know.length
      ? know.map((k) => `- **[${k.contributorRole}${k.collaboratorRole ? ` × ${k.collaboratorRole}` : ""}] ${k.topic}** (${k.confidenceScore}% conf) — ${k.insight}`)
      : ["_None yet._"]),
    "",
  ].join("\n");
  await writeMemoryFile(rel, md);
  return md;
}

export async function syncExecutiveJournal(role: ExecutiveRole): Promise<string> {
  const profile = getExecutiveProfiles()[role];
  const mems = await db.select().from(executiveMemories).where(eq(executiveMemories.executiveRole, role)).orderBy(desc(executiveMemories.id)).limit(400);
  const [{ total }] = await db.select({ total: count() }).from(executiveMemories).where(eq(executiveMemories.executiveRole, role));
  const [persona] = await db.select().from(ceoPersona).orderBy(asc(ceoPersona.id)).limit(1);
  const groups = new Map<string, typeof mems>();
  for (const m of mems) {
    const key = m.sessionId ? `Session #${m.sessionId} — "${clip(m.sessionQuestion || "", 110)}"` : `Archived session — "${clip(m.sessionQuestion || "", 110)}"`;
    groups.set(key, [...(groups.get(key) || []), m]);
  }
  const md = [
    `# ${profile.displayName} — ${role} Long-Term Memory Journal`,
    "",
    `_${profile.job} · ${total} memories stored · Updated ${fmt(new Date())}_`,
    "",
    "## What I Know About the CEO",
    "",
    ...(persona?.profile?.executiveObservations?.[role]?.map((o) => `- ${o}`) || ["- Still learning about the CEO."]),
    "",
    "## Conversation Memory (most recent first)",
    "",
    ...Array.from(groups.entries()).flatMap(([k, items]) => [
      `### ${k}`,
      "",
      ...items.map((m) => `- **[${m.memoryType}${m.counterpartRole ? ` · ${m.counterpartRole}` : ""}]** ${m.content} _(${fmt(m.createdAt)})_`),
      "",
    ]),
  ].join("\n");
  await writeMemoryFile(`executives/${role}.md`, md);
  return md;
}

export async function syncIndexFile(): Promise<string> {
  const profiles = getExecutiveProfiles();
  const sessions = await db.select().from(deliberationSessions).orderBy(desc(deliberationSessions.id));
  const [persona] = await db.select().from(ceoPersona).orderBy(asc(ceoPersona.id)).limit(1);
  const counts = await db
    .select({ role: executiveMemories.executiveRole, c: count() })
    .from(executiveMemories)
    .groupBy(executiveMemories.executiveRole);
  const countOf = (r: string) => counts.find((c) => c.role === r)?.c || 0;
  const md = [
    "# Aether Executive Memory Index",
    "",
    `_Updated ${fmt(new Date())}_`,
    "",
    `- [CEO_PERSONA.md](CEO_PERSONA.md) — living CEO skills & persona profile (v${persona?.version || 0})`,
    "",
    "## Executive Memory Journals",
    "",
    ...ROLES.map((r) => `- [executives/${r}.md](executives/${r}.md) — ${profiles[r].displayName} · ${countOf(r)} memories`),
    "",
    "## Conversation Transcripts",
    "",
    "| Session | CEO Question | Status | Executive Turns | Updated |",
    "|---|---|---|---|---|",
    ...sessions.map((s) => `| [#${s.id}](conversations/${sessionFile(s.id)}) | ${cell(clip(s.ceoQuestion, 120))} | ${s.status} | ${s.turnCount} | ${fmt(s.updatedAt)} |`),
    "",
  ].join("\n");
  await writeMemoryFile("INDEX.md", md);
  return md;
}

/** Background sync after a message: transcript file always, persona when the CEO spoke or a cycle concluded. */
export async function runMemorySync(opts: { sessionId: number; personaTrigger?: string | null }): Promise<void> {
  try {
    await syncSessionTranscript(opts.sessionId);
    if (opts.personaTrigger) await updatePersona(opts.personaTrigger, opts.sessionId);
    else await Promise.all([...ROLES.map((r) => syncExecutiveJournal(r)), syncIndexFile()]);
  } catch (err) {
    console.error("Memory sync failed:", err);
  }
}

export async function rebuildAllMemory(): Promise<void> {
  await ensureMemoryBackfill();
  const sessions = await db.select({ id: deliberationSessions.id }).from(deliberationSessions);
  for (const s of sessions) await syncSessionTranscript(s.id);
  await updatePersona("manual_rebuild", null);
}

export async function listMemoryFiles(): Promise<Array<{ path: string; size: number; updatedAt: string }>> {
  const out: Array<{ path: string; size: number; updatedAt: string }> = [];
  for (const sub of ["", "executives", "conversations"]) {
    try {
      const dir = path.join(/*turbopackIgnore: true*/ MEMORY_DIR, sub);
      for (const ent of await fs.readdir(/*turbopackIgnore: true*/ dir, { withFileTypes: true })) {
        if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
        const st = await fs.stat(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, ent.name));
        out.push({ path: sub ? `${sub}/${ent.name}` : ent.name, size: st.size, updatedAt: st.mtime.toISOString() });
      }
    } catch {
      // directory not created yet
    }
  }
  const rank = (p: string) => (p === "CEO_PERSONA.md" ? 0 : p === "INDEX.md" ? 1 : p.startsWith("executives/") ? 2 : 3);
  return out.sort((a, b) => rank(a.path) - rank(b.path) || b.path.localeCompare(a.path));
}

const SAFE_PATH = /^(CEO_PERSONA\.md|INDEX\.md|executives\/(CTO|CFO|COO)\.md|conversations\/session-\d{1,8}\.md)$/;
export async function getMemoryFileContent(rel: string): Promise<string | null> {
  if (!SAFE_PATH.test(rel)) return null;
  await ensureMemoryBackfill();
  if (rel === "CEO_PERSONA.md") return (await getOrCreatePersona())?.markdown ?? null;
  if (rel === "INDEX.md") return syncIndexFile();
  const ex = rel.match(/^executives\/(CTO|CFO|COO)\.md$/);
  if (ex) return syncExecutiveJournal(ex[1] as ExecutiveRole);
  const cs = rel.match(/^conversations\/session-(\d+)\.md$/);
  return cs ? syncSessionTranscript(Number(cs[1])) : null;
}

export async function getMemoryStats() {
  const byRole = await db
    .select({ role: executiveMemories.executiveRole, c: count() })
    .from(executiveMemories)
    .groupBy(executiveMemories.executiveRole);
  const [m] = await db
    .select({
      total: count(),
      ceo: sql<number>`count(*) filter (where ${conversationMessages.senderRole} = 'CEO')`,
      botToBot: sql<number>`count(*) filter (where ${conversationMessages.senderRole} <> 'CEO' and ${conversationMessages.targetRole} not in ('CEO','ALL'))`,
      botToCeo: sql<number>`count(*) filter (where ${conversationMessages.senderRole} <> 'CEO' and ${conversationMessages.targetRole} = 'CEO')`,
    })
    .from(conversationMessages);
  const memoriesByRole: Record<string, number> = { CTO: 0, CFO: 0, COO: 0 };
  for (const r of byRole) memoriesByRole[r.role] = r.c;
  return {
    totalMessages: m?.total || 0,
    ceoMessages: m?.ceo || 0,
    botToBot: m?.botToBot || 0,
    botToCeo: m?.botToCeo || 0,
    totalMemories: Object.values(memoriesByRole).reduce((a, b) => a + b, 0),
    memoriesByRole,
  };
}
