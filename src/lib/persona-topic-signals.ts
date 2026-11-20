import { CEO_TOPICS, type CeoTopicId } from "./ceo-topics";

const rules: Record<CeoTopicId, { priority: string; re: RegExp }> = {
  technology: {
    priority: "AI, cloud & platform architecture bets",
    re: /\b(ai|gpu|cloud|inference|models?|llm|clusters?|architecture|platform|latency|tokens?|agents?|autonomous|security|zero-trust|data|software|tech\w*)\b/gi,
  },
  finance: {
    priority: "Capital efficiency, margins & ROI",
    re: /(\$[\d.,]+\s*[mbk]?|\b(ebitda|margins?|arr|revenue|budget|capital|roi|payback|cash|valuation|costs?|equity|invest\w*|financ\w*|profit\w*)\b)/gi,
  },
  operations: {
    priority: "Execution speed, SLAs & operating cadence",
    re: /\b(execution|execute|rollout|onboarding|sla|operations?|operational|headcount|hiring|supply|vendors?|process\w*|delivery|timeline|\d+-day|turnaround)\b/gi,
  },
  ma: {
    priority: "Inorganic growth & post-merger integration",
    re: /\b(acqui\w*|mergers?|m&a|startups?|buyouts?|deals?|diligence|post-merger)\b/gi,
  },
  gtm: {
    priority: "Market expansion & enterprise sales",
    re: /\b(europe\w*|global\w*|regions?|regional|markets?|expansion|expand\w*|sales|gtm|go-to-market|international)\b/gi,
  },
  customers: {
    priority: "Customer retention & net revenue growth",
    re: /\b(churn|retention|nrr|upsell|customers?|loyalty|adoption)\b/gi,
  },
  governance: {
    priority: "Risk, compliance & governance",
    re: /\b(risks?|compliance|gdpr|dora|regulat\w*|governance|audit|downside|cannibaliz\w*|sovereign\w*)\b/gi,
  },
  product: {
    priority: "Product strategy & monetization",
    re: /\b(pricing|products?|tiers?|outcome-based|monetiz\w*|bundles?|seats?|seat-based|features?)\b/gi,
  },
};

/** The existing persona heuristic. Counts discussion signals, never tested proficiency. */
export function analyzeTopicSignals(texts: readonly string[]) {
  return CEO_TOPICS.map(({ id, name }) => {
    const { priority, re } = rules[id];
    let hits = 0,
      msgsWith = 0,
      last = "";
    for (const text of texts) {
      const count = (text.match(re) || []).length;
      if (count > 0) {
        hits += count;
        msgsWith++;
        last = text;
      }
    }
    const score = Math.min(98, Math.round(38 + hits * 6 + msgsWith * 7));
    return { id, name, priority, hits, msgsWith, last, score };
  })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
}
