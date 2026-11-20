/** IDs (including the three grandfathered ones) never change or get reassigned. */
import { isExecutiveRole, type ExecutiveRole } from "./executives";
import type { BotProfile } from "./executive-profiles";

export type ExecutiveId = ExecutiveRole | `exec-${string}`;
export function isExecutiveId(value: string): value is ExecutiveId {
  return (
    isExecutiveRole(value) ||
    /^exec-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}
export const ROLE_SUGGESTIONS = [
  "CTO",
  "CFO",
  "COO",
  "Head of Product",
  "Chief of Staff",
  "General Counsel",
];
export const PRESETS = {
  none: "No enterprise access",
  internal: "Internal reader",
  confidential: "Confidential reader",
} as const;
export type ReaderPreset = keyof typeof PRESETS;
export type PermissionPreset = ReaderPreset | "legacy";
export function isReaderPreset(value: unknown): value is ReaderPreset {
  return typeof value === "string" && Object.hasOwn(PRESETS, value);
}
export interface Executive extends BotProfile {
  id: ExecutiveId;
  roleName: string;
  model: string;
  preset: PermissionPreset;
  joinedAfter: number;
  retiredAfter: number | null;
}
export const isActive = (e: Executive) => e.retiredAfter === null;
export const profileOf = ({ displayName, job, skillPrompt }: BotProfile): BotProfile => ({
  displayName,
  job,
  skillPrompt,
});
export const accentOf = (id: string) =>
  id === "CTO" ? "#2563EB" : id === "CFO" ? "#0D9488" : id === "COO" ? "#B45309" : "#6D28D9";

/** Human labels are presentation only. Even a role titled "CEO" submits its own ID. */
export function principalOptions(active: Executive[]) {
  return [
    { value: "CEO", label: "CEO (human)" },
    ...active.map((e) => ({ value: e.id, label: `${e.roleName} · ${e.displayName}` })),
    { value: "EXTERNAL_AGENT", label: "External agent" },
  ];
}
