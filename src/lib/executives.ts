// Legacy identity codes and art templates, not the list of active executives.
export const EXECUTIVE_ROLES = ["CTO", "CFO", "COO"] as const;
export type ExecutiveRole = (typeof EXECUTIVE_ROLES)[number];
export function isExecutiveRole(value: string): value is ExecutiveRole {
  return EXECUTIVE_ROLES.some((role) => role === value);
}

export type RoomZoneId =
  | "ceo-briefing"
  | "strategy-table"
  | "tech-wall"
  | "finance-desk"
  | "window-lounge";

export interface ExecutiveProfile {
  role: ExecutiveRole;
  name: string;
  title: string;
  shortBio: string;
  accentHex: string;
  accentLightHex: string;
  badgeBgClass: string;
  badgeTextClass: string;
  borderClass: string;
  suitColorHex: string;
  shirtColorHex: string;
  tieOrTrimHex: string;
  hairColorHex: string;
  skinToneHex: string;
  homePosition: [number, number, number];
  homeLookAt: [number, number, number];
  specialties: string[];
  defaultModel: string;
}

export const EXECUTIVES: Record<ExecutiveRole, ExecutiveProfile> = {
  CTO: {
    role: "CTO",
    name: "Dr. Elena Vance",
    title: "Chief Technology Officer",
    shortBio:
      "Distributed AI infrastructure, sovereign model architecture, engineering velocity & cybersecurity.",
    accentHex: "#2563EB",
    accentLightHex: "#DBEAFE",
    badgeBgClass: "bg-blue-50",
    badgeTextClass: "text-blue-700",
    borderClass: "border-blue-200",
    suitColorHex: "#1E293B",
    shirtColorHex: "#F8FAFC",
    tieOrTrimHex: "#2563EB",
    hairColorHex: "#18181B",
    skinToneHex: "#F1C8B1",
    homePosition: [-2.35, 0, -0.45],
    homeLookAt: [0, 1.5, 3.8],
    specialties: [
      "AI & Cloud Architecture",
      "R&D Velocity",
      "Security & Latency",
      "Technical Debt",
    ],
    defaultModel: "opencode/deepseek-v4.1-flash-free",
  },
  CFO: {
    role: "CFO",
    name: "Marcus Sterling",
    title: "Chief Financial Officer",
    shortBio:
      "Capital allocation, EBITDA expansion, unit economics, ARR retention & downside risk governance.",
    accentHex: "#0D9488",
    accentLightHex: "#CCFBF1",
    badgeBgClass: "bg-teal-50",
    badgeTextClass: "text-teal-700",
    borderClass: "border-teal-200",
    suitColorHex: "#27272A",
    shirtColorHex: "#FFFFFF",
    tieOrTrimHex: "#0D9488",
    hairColorHex: "#3F3F46",
    skinToneHex: "#E3B396",
    homePosition: [2.35, 0, -0.45],
    homeLookAt: [0, 1.5, 3.8],
    specialties: [
      "Capital Efficiency",
      "Unit Economics & ROI",
      "Gross Margin",
      "Scenario Modeling",
    ],
    defaultModel: "opencode/mimo-v2.6-flash-free",
  },
  COO: {
    role: "COO",
    name: "Sophia Alverez",
    title: "Chief Operating Officer",
    shortBio:
      "Global execution, enterprise GTM delivery, organizational scaling, vendor SLAs & regional compliance.",
    accentHex: "#D97706",
    accentLightHex: "#FEF3C7",
    badgeBgClass: "bg-amber-50",
    badgeTextClass: "text-amber-700",
    borderClass: "border-amber-200",
    suitColorHex: "#57473A",
    shirtColorHex: "#FFFBEB",
    tieOrTrimHex: "#D97706",
    hairColorHex: "#3B2314",
    skinToneHex: "#DFA98A",
    homePosition: [0, 0, -2.55],
    homeLookAt: [0, 1.5, 3.8],
    specialties: [
      "Operational Readiness",
      "Supply & SLA Execution",
      "Org Capacity",
      "Cross-Regional Rollout",
    ],
    defaultModel: "opencode/nemotron-3.5-lightning-free",
  },
};

export interface ZoneLayout {
  id: RoomZoneId;
  label: string;
  subtitle: string;
  center: [number, number, number];
  speakerSlot: [number, number, number];
  listenerSlot: [number, number, number];
  observerSlot: [number, number, number];
  consensusSlots?: Record<ExecutiveRole, [number, number, number]>;
}

export const ROOM_ZONES: Record<RoomZoneId, ZoneLayout> = {
  "ceo-briefing": {
    id: "ceo-briefing",
    label: "CEO Briefing Arc",
    subtitle: "Direct Executive Presentation Zone",
    center: [0, 0, 1.25],
    speakerSlot: [-0.65, 0, 1.2],
    listenerSlot: [0.65, 0, 1.2],
    observerSlot: [0, 0, 0.55],
    consensusSlots: {
      CTO: [-1.45, 0, 1.15],
      COO: [0, 0, 1.35],
      CFO: [1.45, 0, 1.15],
    },
  },
  "strategy-table": {
    id: "strategy-table",
    label: "Glass Strategy Table",
    subtitle: "Cross-Functional Tradeoff Synthesis",
    center: [0, 0, -0.85],
    speakerSlot: [-1.55, 0, -0.85],
    listenerSlot: [1.55, 0, -0.85],
    observerSlot: [0, 0, -2.15],
  },
  "tech-wall": {
    id: "tech-wall",
    label: "AI Architecture Holo-Wall",
    subtitle: "Systems Topology & Technical Review",
    center: [-3.1, 0, -1.35],
    speakerSlot: [-3.05, 0, -0.75],
    listenerSlot: [-2.55, 0, -1.95],
    observerSlot: [-1.75, 0, -1.3],
  },
  "finance-desk": {
    id: "finance-desk",
    label: "Capital & Forecast Station",
    subtitle: "Unit Economics & Margin Telemetry",
    center: [3.1, 0, -1.35],
    speakerSlot: [3.05, 0, -0.75],
    listenerSlot: [2.55, 0, -1.95],
    observerSlot: [1.75, 0, -1.3],
  },
  "window-lounge": {
    id: "window-lounge",
    label: "Skyline Walk-and-Talk Promenade",
    subtitle: "Panoramic Horizon Deliberation Corridor",
    center: [0, 0, -3.15],
    speakerSlot: [-0.85, 0, -3.15],
    listenerSlot: [0.85, 0, -3.15],
    observerSlot: [2.1, 0, -2.85],
  },
};

export const CEO_SAMPLE_DIRECTIVES = [
  "Should we allocate $4.8M this quarter to build dedicated sovereign AI inference clusters or scale via multi-cloud GPU commitments while expanding enterprise sales in Europe?",
  "We are considering acquiring a 65-person workflow automation startup for $38M cash + equity. Walk and talk through technical integration debt, EBITDA impact, and 90-day post-merger execution.",
  "Enterprise churn ticked up from 4.1% to 6.3% due to onboarding latency and AI token overages. Align on an immediate 60-day architectural, pricing, and customer operations turnaround plan.",
  "How should we restructure our flagship platform into an autonomous agent tier with outcome-based pricing without cannibalizing our $82M seat-based ARR?",
];
