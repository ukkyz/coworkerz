import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type AppDatabase } from "@/db";
import { deliberationSessions, executiveRoster as members, opencodeConfigs } from "@/db/schema";
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
const editable = ["displayName", "job", "skillPrompt", "model", "preset"];
export function saveExecutiveProfile(id: string, input: unknown) {
  const data = body(input, editable);
  return db.transaction(
    (tx) => {
      const current = requireActive(id, tx);
      const preset = data.preset === undefined ? current.preset : data.preset;
      if (!isReaderPreset(preset) && !(preset === "legacy" && current.preset === "legacy"))
        throw new RosterError("Choose a permission preset.");
      const model = data.model === undefined ? current.model : validateModel(data.model);
      const changes: Pick<Executive, "displayName" | "job" | "skillPrompt" | "model" | "preset"> = {
        ...settings(data),
        model,
        preset,
      };
      tx.update(members).set(changes).where(eq(members.id, current.id)).run();
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
      return tx
        .insert(members)
        .values({ id, roleName, titleKey, ...profile, model, preset, joinedAfter: boundary })
        .returning(fields)
        .get();
    },
    { behavior: "immediate" },
  );
}
