import { EXECUTIVES, type ExecutiveRole } from "./executives";

// Shared by the form and the server. Only these three plain-text fields are editable.
export const PROFILE_FIELDS = {
  displayName: { label: "Display name", max: 80 },
  job: { label: "Job", max: 120 },
  skillPrompt: { label: "AI skill prompt", max: 2000 },
} as const;
export type ProfileField = keyof typeof PROFILE_FIELDS;
export type BotProfile = Record<ProfileField, string>;
export type ExecutiveProfiles = Record<ExecutiveRole, BotProfile>;
export const PROFILE_KEYS = Object.keys(PROFILE_FIELDS) as ProfileField[];

function defaultProfile(role: ExecutiveRole): BotProfile {
  const { name, title, shortBio, specialties } = EXECUTIVES[role];
  return { displayName: name, job: title, skillPrompt: `${shortBio}\nFocus on: ${specialties.join(", ")}.` };
}

export const DEFAULT_PROFILES: ExecutiveProfiles = {
  CTO: defaultProfile("CTO"), CFO: defaultProfile("CFO"), COO: defaultProfile("COO"),
};

export type ProfileError = { error: string; field?: ProfileField };

export function validateProfile(input: unknown): { profile: BotProfile } | ProfileError {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !Object.hasOwn(PROFILE_FIELDS, key))) {
    return { error: "Send only Display name, Job and AI skill prompt." };
  }
  const profile: BotProfile = { displayName: "", job: "", skillPrompt: "" };
  for (const field of PROFILE_KEYS) {
    const raw = (input as Record<string, unknown>)[field];
    const value = typeof raw === "string" ? raw.trim() : "";
    const { label, max } = PROFILE_FIELDS[field];
    if (!value || value.length > max) return { field, error: `${label} must be 1–${max} characters.` };
    if (field !== "skillPrompt" && /[\r\n]/.test(value)) return { field, error: `${label} must fit on one line.` };
    profile[field] = value;
  }
  return { profile };
}
