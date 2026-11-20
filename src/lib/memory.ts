import { promises as fs } from "fs";
import path from "path";
import { and, asc, count, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, type AppDatabase } from "@/db";
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
import { analyzeTopicSignals } from "./persona-topic-signals";
import { ROOM_ZONES, RoomZoneId } from "./executives";
import { isActive, isExecutiveId, type ExecutiveId } from "./roster";
import { getMember, getRoster } from "./executive-profile-store";
import { getActiveOpencodeConfig } from "./opencode-config";
import { parseStructuredJson, tryLiveOpencodeCompletion } from "./opencode";

export const MEMORY_DIR =
  process.env.MEMORY_DIR?.trim() || path.join(process.cwd(), "memory");
// Membership boundaries use monotonically increasing message IDs, not wall-clock time.
function participantsAt(id: number, tx: AppDatabase) {
  return getRoster(tx).filter(e => e.joinedAfter < id && (e.retiredAfter === null || e.retiredAfter >= id)).map(e => e.id);
}
type SessionRef = { id: number; ceoQuestion: string } | null;

// ---------- helpers ----------
function tag(role: string | null | undefined): string {
  if (!role || role === "ALL") return "the whole C-suite";
  if (role === "CEO") return "the CEO";
  // A durable memory should still identify the right participant after a rename.
  return isExecutiveId(role) ? `the ${role}` : role;
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
// Bound statement size independently of the number of active executives.
function insertMemories(tx: AppDatabase, rows: (typeof executiveMemories.$inferInsert)[]) {
  for (let i=0; i<rows.length; i+=100) tx.insert(executiveMemories).values(rows.slice(i,i+100)).run();
}
function recordMessageMemories(
  msg: ConversationMessage,
  session: SessionRef, tx: AppDatabase
) {
  const base = {
    sessionId: msg.sessionId,
    sessionQuestion: session?.ceoQuestion || null,
    sourceMessageId: msg.id,
    createdAt: msg.createdAt,
  };
  const rows: Array<typeof executiveMemories.$inferInsert> = [];

  const participants = participantsAt(msg.id, tx);
  if (msg.senderRole === "CEO") {
    const type = msg.interactionMode === "ceo_followup" ? "ceo-followup" : "ceo-directive";
    for (const r of participants) {
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
    for (const r of participants) {
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
  insertMemories(tx, rows);
}

function recordLearnedMemory(
  entry: KnowledgeEntry,
  session: SessionRef, tx: AppDatabase
) {
  // Unsourced shared mandates have no membership boundary; never manufacture private recall from them.
  if (!entry.sourceMessageId) return;
  const participants = participantsAt(entry.sourceMessageId, tx);
  const roles =
    entry.contributorRole === "JOINT"
      ? participants
      : participants.filter((r) => r === entry.contributorRole);
  if (!roles.length) return;
  insertMemories(tx, roles.map((r) => ({
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

let backfillSettled = false;
/** Run before a new write, under a database lock even across server processes. */
export function ensureMemoryBackfill() {
  if (backfillSettled) return;
  db.transaction(tx => {
    if (tx.select({id: executiveMemories.id}).from(executiveMemories).limit(1).get()) return;
    const sessions = new Map(tx.select().from(deliberationSessions).all().map(s => [s.id, s]));
    for (const m of tx.select().from(conversationMessages).orderBy(asc(conversationMessages.id)).all()) {
      recordMessageMemories(m, sessions.get(m.sessionId) ?? null, tx);
    }
    for (const k of tx.select().from(knowledgeEntries).orderBy(asc(knowledgeEntries.id)).all()) {
      recordLearnedMemory(k, sessions.get(k.sessionId ?? -1) ?? null, tx);
    }
  }, {behavior: 'immediate'});
  backfillSettled = true;
}

export function persistMemoriesFor(params: { message: ConversationMessage; knowledge?: KnowledgeEntry | null; session: SessionRef }, tx: AppDatabase) {
  recordMessageMemories(params.message, params.session, tx);
  if (params.knowledge) recordLearnedMemory(params.knowledge, params.session, tx);
}

export async function getExecutiveRecall(
  role: ExecutiveId,
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


  const skills = analyzeTopicSignals(texts);

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

  const executiveObservations = Object.fromEntries(getRoster().map(e => {
    const direct = followUps.filter(m => m.targetRole === e.id);
    return [e.id, direct.length ? [`Asked me directly ${direct.length} time(s); latest: "${clip(direct.at(-1)!.content, 110)}".`] : []];
  }));

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
      score: s.score,
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
  ceoTexts: string[],
  sessionId: number | null,
): Promise<{ profile: CeoPersonaProfile; mode: string }> {
  if (!ceoTexts.length) return { profile, mode: "opencode-local-runtime" };
  try {
    const config = await getActiveOpencodeConfig();
    if (!getRoster().some(isActive)) return {profile, mode: "opencode-local-runtime"};
    const raw = await tryLiveOpencodeCompletion({
      config,
      sessionId,
      modelDisplayId: config.cooModel, // CEO persona service model, not a turn by the original COO
      maxTokens: 700,
      systemPrompt:
        'CEO persona/v2. Summarize only the CEO messages provided, as shared preferences, not private observations. Return only JSON: {"executiveSummary":"2-3 sentences","decisionStyle":["one observable preference"]}.',
      userPrompt: `CEO MESSAGES (oldest first):\n${ceoTexts.slice(-25).map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nHEURISTIC PROFILE:\n${JSON.stringify({ skills: profile.skills.map((s) => `${s.name} ${s.score}`), decisionStyle: profile.decisionStyle })}`,
    });
    const parsed = raw
      ? parseStructuredJson<{ executiveSummary?: string; decisionStyle?: unknown[];  }>(raw)
      : null;
    if (!parsed?.executiveSummary || parsed.executiveSummary.length < 40) {
      return { profile, mode: "opencode-local-runtime" };
    }
    const strs = (a: unknown) => (Array.isArray(a) ? a.map(String).filter((s) => s.length > 5) : []);
    const merged: CeoPersonaProfile = {
      ...profile,
      executiveSummary: parsed.executiveSummary.trim(),
      decisionStyle: [...strs(parsed.decisionStyle).slice(0, 3), ...profile.decisionStyle].slice(0, 7),
      aiRefined: true,
    };
    return { profile: merged, mode: "opencode-live" };
  } catch {
    return { profile, mode: "opencode-local-runtime" };
  }
}

function renderPersonaMarkdown(p: CeoPersonaProfile, version: number, at: Date): string {
  const roster = getRoster();
  const bar = (s: number) => `${"█".repeat(Math.round(s / 10))}${"░".repeat(10 - Math.round(s / 10))}`;
  const lines: string[] = [
    "# CEO Persona & Skills Profile",
    "",
    `> Living memory file maintained automatically by your AI C-suite.`,
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
  for (const e of roster) {
    lines.push(`### ${e.displayName} — ${e.roleName}${isActive(e) ? "" : " (archived)"}`, "", ...(p.executiveObservations[e.id] || []).map((o) => `- ${o}`), "");
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
    const refined = await refineWithOpencode(analysis.profile, analysis.ceoTexts, sessionId);
    const profile = refined.profile;
    const [existing] = await db.select().from(ceoPersona).orderBy(asc(ceoPersona.id)).limit(1);
    for (const e of getRoster().filter(e=>!isActive(e))) {
      const previous = existing?.profile?.executiveObservations?.[e.id];
      if (previous) profile.executiveObservations[e.id] = previous;
    }
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
    await syncActiveJournals();
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
  const roster = getRoster();
  const who = (id: string) => {
    const e = roster.find(e => e.id === id);
    return e ? `${e.displayName} (${e.roleName}${isActive(e) ? "" : ", archived"}; ${id})` : id;
  };
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

export async function syncExecutiveJournal(role: ExecutiveId): Promise<string> {
  const profile = getMember(role);
  if (!profile) throw new Error("No such journal");
  const mems = await db.select().from(executiveMemories).where(eq(executiveMemories.executiveRole, role)).orderBy(desc(executiveMemories.id)).limit(400);
  const [{ total }] = await db.select({ total: count() }).from(executiveMemories).where(eq(executiveMemories.executiveRole, role));
  const [persona] = await db.select().from(ceoPersona).orderBy(asc(ceoPersona.id)).limit(1);
  const groups = new Map<string, typeof mems>();
  for (const m of mems) {
    const key = m.sessionId ? `Session #${m.sessionId} — "${clip(m.sessionQuestion || "", 110)}"` : `Archived session — "${clip(m.sessionQuestion || "", 110)}"`;
    groups.set(key, [...(groups.get(key) || []), m]);
  }
  const md = [
    `# ${profile.displayName} — ${profile.roleName} Long-Term Memory Journal (${role})`,
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

async function syncActiveJournals() {
  const active = getRoster().filter(isActive);
  for (let i=0; i<active.length; i+=8) await Promise.all(active.slice(i,i+8).map(e=>syncExecutiveJournal(e.id)));
  await syncIndexFile();
}

export async function syncIndexFile(): Promise<string> {
  const roster = getRoster();
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
    ...roster.map(e => `- [executives/${e.id}.md](executives/${e.id}.md) — ${e.displayName} (${e.roleName}${isActive(e) ? "" : ", archived"}) · ${countOf(e.id)} memories`),
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
    else await syncActiveJournals();
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

const SAFE_PATH = /^(CEO_PERSONA\.md|INDEX\.md|executives\/([\w-]+)\.md|conversations\/session-\d{1,8}\.md)$/;
export async function getMemoryFileContent(rel: string): Promise<string | null> {
  if (!SAFE_PATH.test(rel)) return null;
  await ensureMemoryBackfill();
  if (rel === "CEO_PERSONA.md") return (await getOrCreatePersona())?.markdown ?? null;
  if (rel === "INDEX.md") return syncIndexFile();
  const ex = rel.match(/^executives\/([\w-]+)\.md$/);
  if (ex) { const member = getMember(ex[1]); return member ? syncExecutiveJournal(member.id) : null; }
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
  const memoriesByRole: Record<string, number> = Object.fromEntries(getRoster().map(e=>[e.id,0]));
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
