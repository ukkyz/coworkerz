import type { RoomZoneId } from "./executives";
import { isActive, type Executive, type ExecutiveId } from "./roster";
import type { ConversationMessage } from "@/db/schema";

export interface DeliberationStepPlan {
  stepIndex: number;
  speaker: ExecutiveId;
  listener: ExecutiveId | "CEO";
  interactionMode: "ceo_response" | "walk_and_talk" | "executive_consensus";
  roomZone: RoomZoneId;
  stageLabel: string;
  ceoFollowUp: string | null;
}
const stop = new Set(
  "a an and are as at be by for from how i in is it of on or our should the this to we what with".split(
    " ",
  ),
);
const tokens = (s: string) =>
  new Set(
    (
      s
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((w) => !stop.has(w)),
  );
const stations: RoomZoneId[] = ["strategy-table", "window-lounge", "tech-wall", "finance-desk"];

/** Input roster is in creation order. Stable sort is the final tie breaker. */
export function planDeliberationStep(
  roster: Executive[],
  history: Pick<ConversationMessage, "content" | "senderRole" | "targetRole" | "interactionMode">[],
  rounds: number,
  question: string,
): DeliberationStepPlan | null {
  const lastHeard = new Map<string, number>();
  let lastCeo: (typeof history)[number] | undefined,
    stepIndex = 0;
  history.forEach((m, i) => {
    if (m.senderRole === "CEO") {
      lastCeo = m;
      stepIndex = 0;
    } else {
      lastHeard.set(m.senderRole, i);
      stepIndex++;
    }
  });
  const words = tokens(lastCeo?.content || question);
  const overlap = (s: string) => [...tokens(s)].reduce((n, w) => n + Number(words.has(w)), 0);
  const ranked = roster
    .filter(isActive)
    .map((e) => ({
      e,
      score: 3 * overlap(e.roleName) + 2 * overlap(e.job) + overlap(e.skillPrompt),
    }))
    .sort(
      (a, b) => b.score - a.score || (lastHeard.get(a.e.id) ?? -1) - (lastHeard.get(b.e.id) ?? -1),
    );
  const followUp = lastCeo?.interactionMode === "ceo_followup" ? lastCeo.content : null;
  const direct = stepIndex === 0 && lastCeo && lastCeo.targetRole !== "ALL";
  const speaker = direct ? ranked.find((r) => r.e.id === lastCeo?.targetRole)?.e : ranked[0]?.e;
  if (!speaker) return null;
  const consensus = stepIndex > 0 && (stepIndex + 1) % Math.max(rounds, 2) === 0;
  const peer = ranked.find((r) => r.e.id !== speaker.id)?.e;
  const toCeo = direct || consensus || (!stepIndex && !!followUp) || !peer;
  return {
    stepIndex,
    speaker: speaker.id,
    listener: toCeo ? "CEO" : peer.id,
    interactionMode: consensus ? "executive_consensus" : toCeo ? "ceo_response" : "walk_and_talk",
    roomZone: toCeo ? "ceo-briefing" : stations[stepIndex % stations.length],
    ceoFollowUp: followUp,
    stageLabel: `${speaker.roleName} → ${toCeo ? "CEO" : peer.roleName}${consensus ? " · Consensus" : ""}`,
  };
}
