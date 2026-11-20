import { gatewayBase, CONSOLE_BASE } from "@/lib/gateway-endpoints";
import type { AppDatabase } from "@/db";
import { conversationMessages, deliberationSessions, knowledgeEntries, opencodeConfigs } from "@/db/schema";

export function seedBoardroom(tx: AppDatabase) {
  // Env keys are resolved by the completion client, not copied into the demo file.
  tx.insert(opencodeConfigs).values({ baseUrl: gatewayBase(process.env.OPENCODE_BASE_URL?.trim() || CONSOLE_BASE) }).run();
  const initialQuestion =
    "Should we allocate $4.8M this quarter to build dedicated sovereign AI inference clusters or scale via multi-cloud GPU commitments while expanding enterprise sales in Europe?";

  const seededSession = tx
    .insert(deliberationSessions)
    .values({
      ceoQuestion: initialQuestion,
      status: "completed",
      autoWalkAndTalk: true,
      turnCount: 4,
      executiveSummary:
        "Adopt a hybrid sovereign-edge + multi-cloud burst architecture: deploy $1.9M in Frankfurt EU-sovereign inference nodes first to unlock GDPR/DORA pipeline, retain $2.9M in flexible multi-cloud commit tranches gated by <11-month payback, and staff two EU deployment tiger pods.",
    })
    .returning().get();

  tx.insert(conversationMessages).values({
    sessionId: seededSession.id,
    senderRole: "CEO",
    targetRole: "ALL",
    interactionMode: "ceo_directive",
    roomZone: "ceo-briefing",
    content: initialQuestion,
    modelUsed: "ceo-command",
    providerMode: "human-ceo",
  }).run();

  const msg1 = tx
    .insert(conversationMessages)
    .values({
      sessionId: seededSession.id,
      senderRole: "CTO",
      targetRole: "CFO",
      interactionMode: "walk_and_talk",
      roomZone: "strategy-table",
      content:
        "Marcus, evaluating the CEO's $4.8M sovereign vs. multi-cloud question, going 100% bare-metal upfront locks us into single-generation silicon. If we place $1.9M into quantized EU sovereign inference racks in Frankfurt for regulated workloads and route elastic spikes over multi-cloud Kubernetes, we cut p95 latency by 41% without idle GPU waste.",
      modelUsed: "opencode/deepseek-v4.1-flash-free",
      providerMode: "opencode-local-runtime",
    })
    .returning().get();

  const msg2 = tx
    .insert(conversationMessages)
    .values({
      sessionId: seededSession.id,
      senderRole: "CFO",
      targetRole: "COO",
      interactionMode: "walk_and_talk",
      roomZone: "window-lounge",
      content:
        "Sophia, Elena's $1.9M / $2.9M split improves our cash conversion cycle dramatically—saving 340 bps of gross margin compared to a $4.8M upfront CAPEX outlay. If I structure the remaining $2.9M multi-cloud commit in two ARR-linked tranches with a 10.5-month payback gate, how fast can Operations convert our European enterprise pipeline?",
      modelUsed: "opencode/mimo-v2.6-flash-free",
      providerMode: "opencode-local-runtime",
    })
    .returning().get();

  const msg3 = tx
    .insert(conversationMessages)
    .values({
      sessionId: seededSession.id,
      senderRole: "COO",
      targetRole: "CTO",
      interactionMode: "walk_and_talk",
      roomZone: "tech-wall",
      content:
        "Elena, DACH and French enterprise buyers stall 6–8 weeks in security review unless EU data residency is live. Standing up your Frankfurt sovereign cluster first lets my two EMEA solutions pods compress enterprise onboarding under 14 days and unlock $11.5M in late-stage European ARR this quarter.",
      modelUsed: "opencode/nemotron-3.5-lightning-free",
      providerMode: "opencode-local-runtime",
    })
    .returning().get();

  const msg4 = tx
    .insert(conversationMessages)
    .values({
      sessionId: seededSession.id,
      senderRole: "COO",
      targetRole: "CEO",
      interactionMode: "executive_consensus",
      roomZone: "ceo-briefing",
      content:
        "CEO, after walking through technical topology, capital tranches, and EMEA readiness together, we recommend a hybrid $1.9M Frankfurt sovereign cluster + $2.9M performance-gated multi-cloud burst plan. This protects 75%+ gross margins, clears EU data-residency procurement immediately, and accelerates Q3 European enterprise bookings.",
      modelUsed: "opencode/nemotron-3.5-lightning-free",
      providerMode: "opencode-local-runtime",
    })
    .returning().get();

  tx.insert(knowledgeEntries).values([
    {
      sessionId: seededSession.id,
      sourceMessageId: msg1.id,
      contributorRole: "CTO",
      collaboratorRole: "CFO",
      topic: "Hybrid Sovereign Base + Multi-Cloud Burst Topology",
      insight:
        "Sizing dedicated sovereign GPU capacity to steady-state regulated baseline (~40% of budget) while bursting peak inference across multi-cloud Kubernetes cuts p95 latency 41% and eliminates silicon underutilization.",
      category: "architecture",
      confidenceScore: 94,
      tags: ["sovereign-ai", "multi-cloud", "eu-latency"],
      appliedCount: 2,
    },
    {
      sessionId: seededSession.id,
      sourceMessageId: msg2.id,
      contributorRole: "CFO",
      collaboratorRole: "COO",
      topic: "40/60 Tranche Capital Guardrail (<11-Month Payback)",
      insight:
        "Splitting infrastructure commitments into a 40% foundational tranche and 60% ARR-milestone burst credits preserves 340 bps of gross margin and insulates free cash flow.",
      category: "finance",
      confidenceScore: 95,
      tags: ["capital-allocation", "gross-margin", "capex-vs-opex"],
      appliedCount: 2,
    },
    {
      sessionId: seededSession.id,
      sourceMessageId: msg3.id,
      contributorRole: "COO",
      collaboratorRole: "CTO",
      topic: "EU Data-Residency Pre-Clearance Accelerates EMEA Close",
      insight:
        "Deploying Frankfurt sovereign inference nodes alongside two dedicated EMEA solutions pods removes 6–8 weeks of GDPR/DORA procurement friction and keeps onboarding under 14 days.",
      category: "operations",
      confidenceScore: 92,
      tags: ["emea-gtm", "gdpr-dora", "onboarding-sla"],
      appliedCount: 1,
    },
    {
      sessionId: seededSession.id,
      sourceMessageId: msg4.id,
      contributorRole: "JOINT",
      collaboratorRole: "ALL",
      topic: "Synchronized Infra-Finance-GTM Expansion Playbook",
      insight:
        "Tie regional sovereign AI node activation directly to tranche-gated cloud commitments and localized tiger pods to scale international ARR without margin dilution.",
      category: "cross-functional",
      confidenceScore: 96,
      tags: ["c-suite-consensus", "europe-expansion", "ai-clusters"],
      appliedCount: 3,
    },
  ]).run();
}
