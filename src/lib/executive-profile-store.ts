import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type AppDatabase } from "@/db";
import {
  deliberationSessions,
  executivePromptVersions as promptVersions,
  executiveRoster as members,
  opencodeConfigs,
} from "@/db/schema";
import { validateProfile } from "./executive-profiles";
import { isExecutiveRole } from "./executives";
import {
  isActive,
  isExecutiveId,
  isReaderPreset,
  profileOf,
  type Executive,
  type ExecutiveId,
} from "./roster";

export class RosterError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
  ) {
    super(message);
  }
}

const fields = {
  id: members.id,
  roleName: members.roleName,
  model: members.model,
  preset: members.preset,
  displayName: members.displayName,
  job: members.job,
  skillPrompt: members.skillPrompt,
  joinedAfter: members.joinedAfter,
  retiredAfter: members.retiredAfter,
};
export function getRoster(conn: AppDatabase = db): Executive[] {
  return conn.select(fields).from(members).orderBy(asc(members.sequence)).all();
}
export function getMember(id: string, conn: AppDatabase = db) {
  return isExecutiveId(id)
    ? conn.select(fields).from(members).where(eq(members.id, id)).get()
    : undefined;
}
export function requireActive(id: string, conn: AppDatabase = db) {
  const member = getMember(id, conn);
  if (!member) throw new RosterError("Unknown executive ID.", 404);
  if (!isActive(member))
    throw new RosterError("That executive has left the roster. Choose another recipient.", 409);
  return member;
}
/** Legacy short codes are addresses, never lookups by the current human-readable title. */
export function resolveTarget(value: unknown, tx: AppDatabase) {
  if (value === undefined || (typeof value === "string" && value.toUpperCase() === "ALL")) {
    if (
      !tx
        .select({ id: members.id })
        .from(members)
        .where(isNull(members.retiredAfter))
        .limit(1)
        .get()
    )
      throw new RosterError("No active executives. Add one to resume.", 409);
    return "ALL";
  }
  if (typeof value !== "string" || !value.trim())
    throw new RosterError("Expected ALL or an executive ID.");
  return requireActive(isExecutiveRole(value.toUpperCase()) ? value.toUpperCase() : value, tx).id;
}
export function rosterPayload() {
  const roster = getRoster();
  return {
    roster,
    profiles: Object.fromEntries(roster.filter(isActive).map((e) => [e.id, profileOf(e)])),
  };
}
function highWater(tx: AppDatabase) {
  return tx.get<{ n: number }>(
    sql`select coalesce((select seq from sqlite_sequence where name='conversation_messages'),0) as n`,
  ).n;
}
function body(input: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  ) {
    throw new RosterError("Invalid executive settings.");
  }
  return input as Record<string, unknown>;
}
function settings(data: Record<string, unknown>) {
  const profile = validateProfile({
    displayName: data.displayName,
    job: data.job,
    skillPrompt: data.skillPrompt,
  });
  if ("error" in profile) throw new RosterError(profile.error, 400, profile.field);
  return profile.profile;
}
export function validateModel(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 200 ||
    /\s/.test(value.trim())
  )
    throw new RosterError("Enter a valid model ID.");
  return value.trim();
}
const editable = ["displayName", "job", "skillPrompt", "model", "preset", "changeReason"];
export const PROMPT_REASON_MAX = 200;

/**
 * `skillPrompt` is the only profile field that executes as a model instruction, so a change
 * to it must say why. The reason lands in the append-only prompt log with the diff.
 */
function promptReason(value: unknown, existingPrompt: string, nextPrompt: string): string | null {
  if (existingPrompt === nextPrompt) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new RosterError(
      "Changing the AI skill prompt requires a change reason.",
      400,
      "changeReason",
    );
  }
  const reason = value.trim();
  if (reason.length > PROMPT_REASON_MAX)
    throw new RosterError(
      `Keep the change reason under ${PROMPT_REASON_MAX} characters.`,
      400,
      "changeReason",
    );
  return reason;
}

/** Append the next revision. Called inside the write transaction, never in a request after it. */
export function recordPromptVersion(
  tx: AppDatabase,
  executiveId: ExecutiveId,
  skillPrompt: string,
  previousPrompt: string | null,
  changeReason: string,
  actor = "CEO",
) {
  const latest = tx
    .select({ version: promptVersions.version })
    .from(promptVersions)
    .where(eq(promptVersions.executiveId, executiveId))
    .orderBy(sql`${promptVersions.version} desc`)
    .limit(1)
    .get();
  const version = (latest?.version ?? 0) + 1;
  tx.insert(promptVersions)
    .values({ executiveId, version, skillPrompt, previousPrompt, changeReason, actor })
    .run();
  return version;
}

export function promptHistory(id: string, limit = 20) {
  if (!isExecutiveId(id)) return [];
  return db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.executiveId, id))
    .orderBy(sql`${promptVersions.version} desc`)
    .limit(limit)
    .all();
}

export function saveExecutiveProfile(id: string, input: unknown) {
  const data = body(input, editable);
  return db.transaction(
    (tx) => {
      const current = requireActive(id, tx);
      const preset = data.preset === undefined ? current.preset : data.preset;
      if (!isReaderPreset(preset) && !(preset === "legacy" && current.preset === "legacy"))
        throw new RosterError("Choose a permission preset.");
      const model = data.model === undefined ? current.model : validateModel(data.model);
      const profile = settings(data);
      // Audit the instruction change before it becomes effective.
      const reason = promptReason(data.changeReason, current.skillPrompt, profile.skillPrompt);
      const changes: Pick<Executive, "displayName" | "job" | "skillPrompt" | "model" | "preset"> = {
        ...profile,
        model,
        preset,
      };
      tx.update(members).set(changes).where(eq(members.id, current.id)).run();
      if (reason) {
        recordPromptVersion(
          tx,
          current.id,
          profile.skillPrompt,
          current.skillPrompt,
          reason,
        );
      }
      if (data.model !== undefined && isExecutiveRole(current.id)) {
        const key = { CTO: "ctoModel", CFO: "cfoModel", COO: "cooModel" }[current.id];
        tx.update(opencodeConfigs)
          .set({ [key]: model })
          .where(sql`${opencodeConfigs.id}=(select min(id) from opencode_configs)`)
          .run();
      }
      return { ...current, ...changes };
    },
    { behavior: "immediate" },
  );
}
export function archiveExecutive(id: string) {
  db.transaction(
    (tx) => {
      const current = requireActive(id, tx);
      tx.update(members)
        .set({ retiredAfter: highWater(tx) })
        .where(eq(members.id, current.id))
        .run();
      if (
        !tx
          .select({ id: members.id })
          .from(members)
          .where(isNull(members.retiredAfter))
          .limit(1)
          .get()
      ) {
        tx.update(deliberationSessions)
          .set({ status: "paused", updatedAt: new Date() })
          .where(inArray(deliberationSessions.status, ["active", "deliberating"]))
          .run();
      }
    },
    { behavior: "immediate" },
  );
}
export function createExecutive(input: unknown, replacing?: string) {
  const data = body(input, [...editable, "roleName"]);
  const roleName = typeof data.roleName === "string" ? data.roleName.normalize("NFKC").trim() : "";
  const titleKey = roleName.toLowerCase();
  if (!roleName || roleName.length > 100 || /[\r\n]/.test(roleName)) {
    throw new RosterError("Choose a single-line role title of 1–100 characters.");
  }
  const preset = data.preset;
  if (!isReaderPreset(preset)) throw new RosterError("Review and select a permission preset.");
  const profile = settings(data),
    model = validateModel(data.model);
  return db.transaction(
    (tx) => {
      const boundary = highWater(tx);
      if (replacing !== undefined) {
        const old = requireActive(replacing, tx);
        tx.update(members).set({ retiredAfter: boundary }).where(eq(members.id, old.id)).run();
      }
      if (
        tx
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.titleKey, titleKey), isNull(members.retiredAfter)))
          .get()
      ) {
        throw new RosterError("Another active executive already has that role title.", 409);
      }
      const id: ExecutiveId = `exec-${randomUUID()}`;
      const created = tx
        .insert(members)
        .values({ id, roleName, titleKey, ...profile, model, preset, joinedAfter: boundary })
        .returning(fields)
        .get();
      // A new identity starts its prompt log at the version it was created with, so the
      // first edit already has a predecessor to diff against.
      recordPromptVersion(tx, id, created.skillPrompt, null, "created", "CEO");
      return created;
    },
    { behavior: "immediate" },
  );
}
