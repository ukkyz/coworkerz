// Stable display order, independent of score, session, or the current executive roster.
export const CEO_TOPICS = [
  { id: "technology", label: "Technology", name: "AI & Technology Strategy" },
  { id: "finance", label: "Finance", name: "Capital Allocation & Financial Acumen" },
  { id: "operations", label: "Operations", name: "Operational Execution & Scaling" },
  { id: "ma", label: "M&A", name: "M&A & Corporate Development" },
  { id: "gtm", label: "Go-to-market", name: "Go-To-Market & Global Expansion" },
  { id: "customers", label: "Customers", name: "Customer Retention & Growth" },
  { id: "governance", label: "Governance", name: "Risk Management & Governance" },
  { id: "product", label: "Product", name: "Product & Pricing Innovation" },
] as const;

export type CeoTopicId = (typeof CEO_TOPICS)[number]["id"];
// Absent means unobserved, not a score of zero.
export type TopicReadings = Partial<Record<CeoTopicId, { score: number; signals: number }>>;

export interface CeoRadar {
  revision: number; // 0 = unsaved preview
  capturedAt: string | null;
  personaVersion: number | null; // no materialized persona yet: use the same local topic rules
  ceoMessages: number;
  readings: TopicReadings;
}
