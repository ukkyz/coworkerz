import { eq } from "drizzle-orm";
import { db } from "@/db";
import { executiveProfileOverrides as overrides } from "@/db/schema";
import { DEFAULT_PROFILES, PROFILE_KEYS, type BotProfile, type ExecutiveProfiles } from "./executive-profiles";
import type { ExecutiveRole } from "./executives";

export function getExecutiveProfiles(): ExecutiveProfiles {
  const profiles = { ...DEFAULT_PROFILES };
  for (const { role, displayName, job, skillPrompt } of db.select().from(overrides).all()) {
    profiles[role] = { displayName, job, skillPrompt };
  }
  return profiles;
}

export function saveExecutiveProfile(role: ExecutiveRole, profile: BotProfile) {
  if (PROFILE_KEYS.every((key) => profile[key] === DEFAULT_PROFILES[role][key])) {
    db.delete(overrides).where(eq(overrides.role, role)).run();
  } else {
    db.insert(overrides).values({ role, ...profile })
      .onConflictDoUpdate({ target: overrides.role, set: profile }).run();
  }
}

// Deliberately do not pass a roster of skill prompts to the turn generator.
export function getTurnIdentity(speaker: ExecutiveRole) {
  const profiles = getExecutiveProfiles();
  return {
    speakerProfile: profiles[speaker],
    names: { CTO: profiles.CTO.displayName, CFO: profiles.CFO.displayName, COO: profiles.COO.displayName },
  };
}
