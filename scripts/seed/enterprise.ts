import type { AppDatabase } from "@/db";
import {
  ekChunks, ekDocuments, ekDomains, ekEntities, ekRelationships, ekTaxonomySchemes,
  type ClearanceLevel, type EkDocument, type EkEntity, type EnterpriseDocMetadata,
} from "@/db/schema";
import {
  DEFAULT_ENTERPRISE_TAXONOMY_YAML, chunkDocumentContent, classifyWithSkosScheme,
  computeSemanticEmbedding, exportSkosTurtle, parseTaxonomyYaml,
} from "@/lib/enterprise-taxonomy";

/** Populate synthetic governed knowledge without calling an inference provider. */
export function seedEnterprise(tx: AppDatabase) {
  tx.insert(ekDomains).values([
    {
      key: "technology",
      name: "AI & Cloud Architecture",
      description:
        "Sovereign GPU clusters, multi-cloud Kubernetes elasticity, model gateways, latency SLOs, and zero-trust security RFCs.",
      ownerRole: "CTO",
      colorHex: "#2563EB",
      defaultClearance: "internal",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      aclWriteRoles: ["CEO", "CTO"],
    },
    {
      key: "finance",
      name: "Corporate Finance & Capital",
      description:
        "Capital allocation hurdle rates, 40/60 CAPEX/OPEX tranche gates, gross-margin floors, ARR quality, and EBITDA models.",
      ownerRole: "CFO",
      colorHex: "#0D9488",
      defaultClearance: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO", "CTO"],
      aclWriteRoles: ["CEO", "CFO"],
    },
    {
      key: "operations",
      name: "Global Operations & Delivery",
      description:
        "EMEA regional tiger pods, <14-day onboarding playbooks, 99.95% enterprise SLAs, vendor tiers, and churn turnarounds.",
      ownerRole: "COO",
      colorHex: "#D97706",
      defaultClearance: "internal",
      aclReadRoles: ["CEO", "COO", "CTO", "CFO", "EXTERNAL_AGENT"],
      aclWriteRoles: ["CEO", "COO"],
    },
    {
      key: "governance",
      name: "Legal, Risk & Regulatory",
      description:
        "EU GDPR sovereign data residency, DORA financial-sector resilience, EU AI Act model controls, and role-based ACL policy.",
      ownerRole: "CEO",
      colorHex: "#7C3AED",
      defaultClearance: "internal",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      aclWriteRoles: ["CEO"],
    },
    {
      key: "corporate_strategy",
      name: "Board Strategy, M&A & Pricing",
      description:
        "Board-restricted M&A due diligence, valuation term sheets, outcome-based AI packaging, and multi-year expansion OKRs.",
      ownerRole: "CEO",
      colorHex: "#E11D48",
      defaultClearance: "board_restricted",
      aclReadRoles: ["CEO", "CFO"],
      aclWriteRoles: ["CEO"],
    },
  ]).run();

  const parsed = parseTaxonomyYaml(DEFAULT_ENTERPRISE_TAXONOMY_YAML);
  const turtle = exportSkosTurtle({
    schemeUri: parsed.schemeUri,
    title: parsed.title,
    version: 1,
    concepts: parsed.concepts,
    objectProperties: parsed.objectProperties,
  });
  const scheme = tx
    .insert(ekTaxonomySchemes)
    .values({
      schemeUri: parsed.schemeUri,
      title: parsed.title,
      version: 1,
      format: "yaml-skos",
      yamlContent: DEFAULT_ENTERPRISE_TAXONOMY_YAML,
      skosTurtle: turtle,
      parsedConcepts: parsed.concepts,
      updatedBy: "CEO",
    })
    .returning().get();

  const seedDocs: Array<{
    slug: string;
    title: string;
    docType: string;
    domainKey: string;
    classificationLevel: ClearanceLevel;
    aclReadRoles: string[];
    aclWriteRoles: string[];
    reviewStatus: "approved" | "pending_review";
    reviewerNotes?: string;
    metadata: EnterpriseDocMetadata;
    content: string;
  }> = [
    {
      slug: "rfc-104-hybrid-sovereign-ai-cluster",
      title: "RFC-104: Frankfurt Sovereign AI Cluster & Multi-Cloud Burst Architecture",
      docType: "architecture_rfc",
      domainKey: "technology",
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      aclWriteRoles: ["CEO", "CTO"],
      reviewStatus: "approved",
      reviewerNotes: "Approved by CEO & CTO as baseline EU AI topology.",
      metadata: {
        author: "Dr. Elena Vance (CTO)",
        version: "2.1",
        effectiveDate: "2026-Q3",
        region: "EU-Central (Frankfurt)",
        sourceSystem: "Architecture Board",
      },
      content: `## Sovereign Baseline Topology
Aether deploys a $1.9M dedicated sovereign GPU inference cluster in Frankfurt (eu-central-sov-1) running quantized FP8 serving racks with strict zero-retention tenant isolation. All regulated European customer prompts, embeddings, and telemetry remain inside the EU legal boundary to satisfy GDPR and DORA requirements.

## Elastic Multi-Cloud Burst & Latency SLOs
Peak non-sovereign and overflow inference traffic bursts across multi-cloud Kubernetes GPU pools via the Aether Model Gateway with streaming semantic caching. Benchmarks confirm a 41% reduction in p95 latency (from 820ms to 484ms) and 52% fewer uncached token spikes while eliminating idle single-generation silicon risk.`,
    },
    {
      slug: "fin-201-capex-tranche-margin-policy",
      title: "FIN-201: 40/60 Capital Tranche Governance & 74% Gross Margin Floor",
      docType: "financial_model",
      domainKey: "finance",
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO"],
      aclWriteRoles: ["CEO", "CFO"],
      reviewStatus: "approved",
      reviewerNotes: "Approved capital allocation policy for FY2026 infrastructure & GTM bets.",
      metadata: {
        author: "Marcus Sterling (CFO)",
        version: "3.0",
        effectiveDate: "2026-Q3",
        region: "Global",
        sourceSystem: "FP&A Treasury Vault",
      },
      content: `## Tranche Release Rules
Any infrastructure or AI cloud investment exceeding $1.5M must be structured into a maximum 40% foundational commitment ($1.9M Frankfurt baseline) and a 60% milestone-gated tranche ($2.9M multi-cloud GPU commit). Tranche 2 unlocks only when trailing net dollar retention exceeds 118% and verified payback stays under 10.5 months.

## Margin & Free Cash Flow Guardrails
Consolidated SaaS + AI gross margin must remain at or above 74.5%, preserving 340 bps of EBITDA expansion versus upfront bare-metal CAPEX outlays. Per-tenant token circuit breakers enforce hard COGS ceilings on high-volume enterprise accounts.`,
    },
    {
      slug: "ops-305-emea-tiger-pods-sla-runbook",
      title: "OPS-305: EMEA Regional Tiger Pods & 14-Day Enterprise Onboarding Runbook",
      docType: "runbook",
      domainKey: "operations",
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "COO", "CTO", "CFO", "EXTERNAL_AGENT"],
      aclWriteRoles: ["CEO", "COO"],
      reviewStatus: "approved",
      reviewerNotes: "Approved operational playbook for Q3 DACH & France expansion.",
      metadata: {
        author: "Sophia Alverez (COO)",
        version: "1.8",
        effectiveDate: "2026-Q3",
        region: "EMEA (DACH, France, Nordics)",
        sourceSystem: "Global Ops Handbook",
      },
      content: `## EMEA Tiger Pod Staffing & Onboarding SLA
Operations staffs two dedicated EMEA cross-functional tiger pods (solutions architect, forward-deployed AI engineer, compliance specialist) aligned to DACH and French enterprise accounts. Pre-cleared Frankfurt sovereign residency eliminates 6-8 weeks of security questionnaire stalls and holds enterprise onboarding time under 14 calendar days.

## Contractual Reliability & Pipeline Unlock
Tier-1 enterprise customers receive a 99.95% inference uptime SLA with 15-minute P1 incident escalation and automated multi-cloud failover. Executing this playbook unlocks $11.5M in late-stage Q3 European ARR within existing headcount ratios.`,
    },
    {
      slug: "pol-402-eu-gdpr-dora-ai-governance",
      title: "POL-402: EU GDPR Data Residency, DORA ICT Resilience & AI ACL Standard",
      docType: "policy",
      domainKey: "governance",
      classificationLevel: "public",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      aclWriteRoles: ["CEO"],
      reviewStatus: "approved",
      reviewerNotes: "Mandatory enterprise compliance baseline shareable with external AI tools.",
      metadata: {
        author: "Office of General Counsel & CEO",
        version: "4.0",
        effectiveDate: "2026-Q2",
        region: "EU & Global",
        sourceSystem: "GRC Policy Registry",
      },
      content: `## GDPR Sovereign Residency & DORA Exit Controls
Regulated European banking, insurance, and public-sector workloads must process and store data exclusively on Frankfurt EU sovereign infrastructure under EU-only cryptographic keys. Under DORA Article 28, Aether maintains documented 72-hour multi-cloud exit plans, annual penetration audit attestations, and ISO 27001 / SOC 2 Type II coverage.

## Enterprise AI Knowledge Separation & ACL Mandate
Canonical enterprise knowledge documents must be strictly isolated from conversational agent memory logs. Every document, vector passage, and knowledge graph entity enforces role-based ACLs, clearance levels, and human-in-the-loop taxonomy verification under EU AI Act governance.`,
    },
    {
      slug: "memo-501-project-kestrel-ma-term-sheet",
      title: "MEMO-501: Project Kestrel $38M M&A Valuation, Earnout & PMI Playbook",
      docType: "board_memo",
      domainKey: "corporate_strategy",
      classificationLevel: "board_restricted",
      aclReadRoles: ["CEO", "CFO"],
      aclWriteRoles: ["CEO"],
      reviewStatus: "approved",
      reviewerNotes: "Strictly Board-Restricted to CEO & CFO until LOI signature.",
      metadata: {
        author: "CEO & Corporate Development",
        version: "1.2",
        effectiveDate: "2026-Q3",
        region: "North America & EU",
        sourceSystem: "Board Data Room",
      },
      content: `## Deal Structure & EBITDA Protection
Project Kestrel (65-person workflow automation & zero-trust connector startup, $7.4M ARR) is valued at $38M: $22M cash at close, $10M equity, and $6M retention/ARR earnout tied to 18-month milestones. Structure caps Year-1 EBITDA dilution at 110 bps and achieves cash-flow accretive synergy by Month 14.

## 90-Day Post-Merger Integration Gate
Technical integration isolates Kestrel's runtime behind an event-driven zero-trust adapter gateway within 45 days to avoid identity-federation technical debt, targeting $9.2M in cross-sell ARR across Aether's $82M enterprise install base.`,
    },
    {
      slug: "strat-504-agentic-tier-outcome-pricing-draft",
      title: "STRAT-504: Autonomous Agent Tier & Hybrid Outcome-Based Pricing Proposal",
      docType: "board_memo",
      domainKey: "corporate_strategy",
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "CTO", "COO"],
      aclWriteRoles: ["CEO"],
      reviewStatus: "pending_review",
      metadata: {
        author: "Strategy & Monetization Working Group",
        version: "0.9-draft",
        effectiveDate: "2026-Q4",
        region: "Global",
        sourceSystem: "Pricing Committee",
      },
      content: `## Hybrid Seat + Execution Credit Model
To launch the Aether Autonomous Agent Tier without cannibalizing our $82M seat-based ARR, enterprise contracts retain 100% of core platform seats plus committed autonomous execution-credit packs priced per verified workflow outcome. Financial simulations project +7.5% gross margin expansion on top-quartile accounts and +620 bps NRR uplift.`,
    },
    {
      slug: "rfc-109-zero-trust-adapter-gateway-draft",
      title: "RFC-109: Zero-Trust Identity Federation & Semantic Cache Circuit Breakers",
      docType: "architecture_rfc",
      domainKey: "technology",
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "CTO", "COO"],
      aclWriteRoles: ["CEO", "CTO"],
      reviewStatus: "pending_review",
      metadata: {
        author: "Principal Security Architect",
        version: "0.7-draft",
        effectiveDate: "2026-Q3",
        region: "Global",
        sourceSystem: "Engineering RFC Queue",
      },
      content: `## Tenant Quota Circuit Breakers & Churn Defense
Introduces per-tenant token burst circuit breakers, SAML/OIDC zero-trust identity federation, and streaming semantic cache layers on the Aether Model Gateway. Designed to eliminate onboarding ingestion latency and cut enterprise AI token overages by 52%, directly addressing the churn uptick from 4.1% to 6.3%.`,
    },
  ];

  const insertedDocs = new Map<string, EkDocument>();
  for (const d of seedDocs) {
    const classified = classifyWithSkosScheme({
      title: d.title,
      content: d.content,
      concepts: scheme.parsedConcepts,
    });
    const summary = d.content
      .replace(/^##\s+.+$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 260);
    const emb = computeSemanticEmbedding(`${d.title}. ${d.content}`);

    const doc = tx
      .insert(ekDocuments)
      .values({
        slug: d.slug,
        title: d.title,
        docType: d.docType,
        domainKey: d.domainKey,
        secondaryDomains: classified.secondaryDomains.filter(
          (x) => x !== d.domainKey
        ),
        summary,
        content: d.content,
        classificationLevel: d.classificationLevel,
        aclReadRoles: d.aclReadRoles,
        aclWriteRoles: d.aclWriteRoles,
        metadata: d.metadata,
        taxonomyConcepts: classified.tags,
        classifierMode: "skos-hybrid-classifier",
        reviewStatus: d.reviewStatus,
        reviewedBy: d.reviewStatus === "approved" ? "CEO" : null,
        reviewerNotes: d.reviewerNotes || null,
        reviewedAt: d.reviewStatus === "approved" ? new Date() : null,
        embedding: emb,
      })
      .returning().get();

    insertedDocs.set(d.slug, doc);

    const chunks = chunkDocumentContent(d.title, d.content);
    tx.insert(ekChunks).values(
      chunks.map((c) => ({
        documentId: doc.id,
        domainKey: d.domainKey,
        chunkIndex: c.chunkIndex,
        heading: c.heading,
        content: c.content,
        tokenCount: c.tokenCount,
        embedding: c.embedding,
      }))
    ).run();
  }

  // 4. Seed Domain-Tagged Knowledge Graph Entities & Cross-Domain Relationships
  const docId = (slug: string) => insertedDocs.get(slug)?.id ?? null;

  const entitySeeds: Array<{
    key: string;
    name: string;
    entityType: string;
    domainKey: string;
    taxonomyConceptId: string;
    description: string;
    attributes: Record<string, string>;
    classificationLevel: ClearanceLevel;
    aclReadRoles: string[];
    docSlug: string;
  }> = [
    // Technology subgraph
    {
      key: "frankfurt-sovereign-cluster",
      name: "Frankfurt Sovereign GPU Cluster",
      entityType: "System",
      domainKey: "technology",
      taxonomyConceptId: "tech:sovereign-ai-infra",
      description:
        "Dedicated $1.9M EU-resident FP8 GPU inference cluster in Frankfurt with zero-retention tenant isolation.",
      attributes: { budget: "$1.9M", region: "eu-central-sov-1", p95Delta: "-41%" },
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "rfc-104-hybrid-sovereign-ai-cluster",
    },
    {
      key: "multicloud-k8s-burst",
      name: "Multi-Cloud K8s Inference Burst",
      entityType: "System",
      domainKey: "technology",
      taxonomyConceptId: "tech:multicloud-elasticity",
      description:
        "Elastic Kubernetes GPU burst pool with streaming semantic cache handling peak inference traffic.",
      attributes: { trancheBudget: "$2.9M", overageCut: "-52%", p95Slo: "484ms" },
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "rfc-104-hybrid-sovereign-ai-cluster",
    },
    {
      key: "zero-trust-adapter-gateway",
      name: "Zero-Trust Adapter & Quota Gateway",
      entityType: "System",
      domainKey: "technology",
      taxonomyConceptId: "tech:security-zero-trust",
      description:
        "Event-driven SAML/OIDC federation gateway and per-tenant token circuit breaker for M&A and churn defense.",
      attributes: { integrationSla: "45 days", tokenBurstCut: "-52%" },
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO"],
      docSlug: "rfc-109-zero-trust-adapter-gateway-draft",
    },
    // Finance subgraph
    {
      key: "tranche-capital-facility",
      name: "40/60 Capital Tranche Facility",
      entityType: "FinancialInstrument",
      domainKey: "finance",
      taxonomyConceptId: "fin:capex-tranche-governance",
      description:
        "Staged $4.8M capital vehicle ($1.9M base + $2.9M milestone tranche) requiring <10.5-month payback.",
      attributes: { totalEnvelope: "$4.8M", split: "40% / 60%", paybackGate: "<10.5 mo" },
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO"],
      docSlug: "fin-201-capex-tranche-margin-policy",
    },
    {
      key: "gross-margin-floor-kpi",
      name: "74.5% Gross Margin & EBITDA Floor",
      entityType: "Metric",
      domainKey: "finance",
      taxonomyConceptId: "fin:unit-economics-finops",
      description:
        "Mandatory enterprise gross-margin threshold preserving +340 bps EBITDA expansion and 118%+ NRR.",
      attributes: { grossMarginMin: "74.5%", ebitdaSavings: "+340 bps", nrrGate: ">118%" },
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO", "CTO"],
      docSlug: "fin-201-capex-tranche-margin-policy",
    },
    {
      key: "core-seat-arr-base",
      name: "$82M Enterprise Seat ARR Base",
      entityType: "Metric",
      domainKey: "finance",
      taxonomyConceptId: "fin:unit-economics-finops",
      description:
        "Core recurring enterprise subscription base protected against cannibalization during AI tier expansion.",
      attributes: { arr: "$82M", churnCurrent: "6.3%", churnTarget: "<4.0%" },
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO", "CTO"],
      docSlug: "strat-504-agentic-tier-outcome-pricing-draft",
    },
    // Operations subgraph
    {
      key: "emea-tiger-pods",
      name: "EMEA Solutions Tiger Pods",
      entityType: "Team",
      domainKey: "operations",
      taxonomyConceptId: "ops:emea-delivery-pods",
      description:
        "Two cross-functional European deployment squads serving DACH & French enterprise accounts.",
      attributes: { pods: "2 squads", onboardingSla: "<14 days", targetRegions: "DACH, FR" },
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "COO", "CTO", "CFO", "EXTERNAL_AGENT"],
      docSlug: "ops-305-emea-tiger-pods-sla-runbook",
    },
    {
      key: "tier1-enterprise-sla",
      name: "Tier-1 99.95% Enterprise SLA",
      entityType: "Initiative",
      domainKey: "operations",
      taxonomyConceptId: "ops:sla-reliability",
      description:
        "Contractual 99.95% uptime, <14-day onboarding, and 15-min P1 escalation standard protecting retention.",
      attributes: { uptime: "99.95%", p1Response: "15 min", onboarding: "<14 days" },
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "COO", "CTO", "CFO", "EXTERNAL_AGENT"],
      docSlug: "ops-305-emea-tiger-pods-sla-runbook",
    },
    // Governance subgraph
    {
      key: "eu-gdpr-residency",
      name: "EU GDPR Sovereign Data Residency",
      entityType: "Regulation",
      domainKey: "governance",
      taxonomyConceptId: "gov:eu-data-residency",
      description:
        "Binding EU boundary data processing, customer-managed EU encryption keys, and zero-retention mandate.",
      attributes: { jurisdiction: "EU / EEA", keyCustody: "EU-only HSM" },
      classificationLevel: "public",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "pol-402-eu-gdpr-dora-ai-governance",
    },
    {
      key: "eu-dora-act",
      name: "DORA ICT Operational Resilience",
      entityType: "Regulation",
      domainKey: "governance",
      taxonomyConceptId: "gov:dora-cyber-resilience",
      description:
        "EU financial-sector ICT third-party risk regulation requiring 72-hour cloud exit plans and audit rights.",
      attributes: { exitSla: "72 hours", certs: "ISO 27001, SOC2 II" },
      classificationLevel: "public",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "pol-402-eu-gdpr-dora-ai-governance",
    },
    {
      key: "eu-ai-act-acl-policy",
      name: "EU AI Act & Knowledge ACL Standard",
      entityType: "Regulation",
      domainKey: "governance",
      taxonomyConceptId: "gov:ai-safety-governance",
      description:
        "Mandates strict isolation of enterprise KB from agent memory, role ACLs, and human taxonomy review.",
      attributes: { reviewMode: "Human-in-the-Loop", isolation: "Strict Plane Split" },
      classificationLevel: "public",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "pol-402-eu-gdpr-dora-ai-governance",
    },
    // Corporate Strategy subgraph
    {
      key: "emea-q3-arr-expansion",
      name: "$11.5M EMEA Q3 ARR Expansion",
      entityType: "Initiative",
      domainKey: "corporate_strategy",
      taxonomyConceptId: "strat:international-expansion",
      description:
        "Late-stage regulated European enterprise bookings unlocked by sovereign residency and EMEA pods.",
      attributes: { pipelineArr: "$11.5M", horizon: "2026-Q3", closeSpeedup: "+30%" },
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO", "CTO"],
      docSlug: "ops-305-emea-tiger-pods-sla-runbook",
    },
    {
      key: "autonomous-agent-tier",
      name: "Aether Autonomous Agent Tier",
      entityType: "Product",
      domainKey: "corporate_strategy",
      taxonomyConceptId: "strat:agentic-pricing",
      description:
        "Hybrid platform seat + outcome-based execution credit tier projecting +7.5% margin expansion.",
      attributes: { marginLift: "+7.5%", nrrLift: "+620 bps", status: "Pending Review" },
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "CTO", "COO"],
      docSlug: "strat-504-agentic-tier-outcome-pricing-draft",
    },
    {
      key: "project-kestrel-acquisition",
      name: "Project Kestrel ($38M M&A Target)",
      entityType: "Organization",
      domainKey: "corporate_strategy",
      taxonomyConceptId: "strat:ma-corporate-dev",
      description:
        "Board-restricted 65-person workflow automation acquisition ($22M cash, $10M equity, $6M earnout).",
      attributes: { dealValue: "$38M", targetArr: "$7.4M", crossSell: "$9.2M" },
      classificationLevel: "board_restricted",
      aclReadRoles: ["CEO", "CFO"],
      docSlug: "memo-501-project-kestrel-ma-term-sheet",
    },
  ];

  const entityMap = new Map<string, EkEntity>();
  for (const e of entitySeeds) {
    const row = tx
      .insert(ekEntities)
      .values({
        canonicalKey: e.key,
        name: e.name,
        entityType: e.entityType,
        domainKey: e.domainKey,
        taxonomyConceptId: e.taxonomyConceptId,
        description: e.description,
        attributes: e.attributes,
        classificationLevel: e.classificationLevel,
        aclReadRoles: e.aclReadRoles,
        sourceDocumentId: docId(e.docSlug),
      })
      .returning().get();
    entityMap.set(e.key, row);
  }

  const relSeeds: Array<{
    from: string;
    to: string;
    predicate: string;
    domainKey: string;
    weight: number;
    evidence: string;
    classificationLevel: ClearanceLevel;
    aclReadRoles: string[];
    docSlug: string;
  }> = [
    // Intra-domain edges (build rich per-group subgraphs)
    {
      from: "frankfurt-sovereign-cluster",
      to: "multicloud-k8s-burst",
      predicate: "INTEGRATES_WITH",
      domainKey: "technology",
      weight: 95,
      evidence: "Overflows non-sovereign elastic GPU bursts via Kubernetes model router.",
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "rfc-104-hybrid-sovereign-ai-cluster",
    },
    {
      from: "zero-trust-adapter-gateway",
      to: "multicloud-k8s-burst",
      predicate: "MITIGATES_RISK",
      domainKey: "technology",
      weight: 90,
      evidence: "Enforces per-tenant token circuit breakers and semantic cache quotas.",
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO"],
      docSlug: "rfc-109-zero-trust-adapter-gateway-draft",
    },
    {
      from: "tranche-capital-facility",
      to: "gross-margin-floor-kpi",
      predicate: "GATED_BY_METRIC",
      domainKey: "finance",
      weight: 96,
      evidence: "60% burst tranche requires 74.5%+ gross margin, >118% NRR, and <10.5m payback.",
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO"],
      docSlug: "fin-201-capex-tranche-margin-policy",
    },
    {
      from: "gross-margin-floor-kpi",
      to: "core-seat-arr-base",
      predicate: "MITIGATES_RISK",
      domainKey: "finance",
      weight: 89,
      evidence: "Protects free cash flow and margin quality across the $82M ARR base.",
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO", "CTO"],
      docSlug: "fin-201-capex-tranche-margin-policy",
    },
    {
      from: "emea-tiger-pods",
      to: "tier1-enterprise-sla",
      predicate: "OPERATED_BY",
      domainKey: "operations",
      weight: 92,
      evidence: "EMEA tiger pods execute <14-day onboarding and 99.95% uptime runbooks.",
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "COO", "CTO", "CFO", "EXTERNAL_AGENT"],
      docSlug: "ops-305-emea-tiger-pods-sla-runbook",
    },
    {
      from: "eu-dora-act",
      to: "eu-gdpr-residency",
      predicate: "DEPENDS_ON",
      domainKey: "governance",
      weight: 91,
      evidence: "DORA financial resilience builds on EU sovereign residency & HSM key custody.",
      classificationLevel: "public",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "pol-402-eu-gdpr-dora-ai-governance",
    },
    // Cross-domain edges (enable multi-hop cross-domain QA across groups!)
    {
      from: "frankfurt-sovereign-cluster",
      to: "tranche-capital-facility",
      predicate: "FUNDED_BY",
      domainKey: "finance",
      weight: 97,
      evidence: "Funded via the 40% ($1.9M) foundational tranche of FIN-201.",
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO"],
      docSlug: "fin-201-capex-tranche-margin-policy",
    },
    {
      from: "multicloud-k8s-burst",
      to: "tranche-capital-facility",
      predicate: "FUNDED_BY",
      domainKey: "finance",
      weight: 94,
      evidence: "Funded by the $2.9M milestone-gated 60% multi-cloud tranche.",
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO"],
      docSlug: "fin-201-capex-tranche-margin-policy",
    },
    {
      from: "frankfurt-sovereign-cluster",
      to: "eu-gdpr-residency",
      predicate: "SATISFIES_REGULATION",
      domainKey: "governance",
      weight: 98,
      evidence: "In-region Frankfurt FP8 racks keep all EU prompts & keys within EEA.",
      classificationLevel: "public",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "pol-402-eu-gdpr-dora-ai-governance",
    },
    {
      from: "multicloud-k8s-burst",
      to: "eu-dora-act",
      predicate: "SATISFIES_REGULATION",
      domainKey: "governance",
      weight: 93,
      evidence: "Provides documented 72-hour DORA Article 28 multi-cloud exit resilience.",
      classificationLevel: "public",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "pol-402-eu-gdpr-dora-ai-governance",
    },
    {
      from: "frankfurt-sovereign-cluster",
      to: "emea-tiger-pods",
      predicate: "OPERATED_BY",
      domainKey: "operations",
      weight: 91,
      evidence: "Enables EMEA solutions pods to eliminate 6-8 week security stalls.",
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "COO", "CTO", "CFO", "EXTERNAL_AGENT"],
      docSlug: "ops-305-emea-tiger-pods-sla-runbook",
    },
    {
      from: "emea-tiger-pods",
      to: "emea-q3-arr-expansion",
      predicate: "UNLOCKS_REVENUE",
      domainKey: "corporate_strategy",
      weight: 95,
      evidence: "Unlocks $11.5M in late-stage DACH and French enterprise ARR in Q3.",
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "COO", "CTO"],
      docSlug: "ops-305-emea-tiger-pods-sla-runbook",
    },
    {
      from: "zero-trust-adapter-gateway",
      to: "tier1-enterprise-sla",
      predicate: "MITIGATES_RISK",
      domainKey: "operations",
      weight: 89,
      evidence: "Eliminates onboarding latency & token overages driving 6.3% churn.",
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "CTO", "COO", "CFO"],
      docSlug: "rfc-109-zero-trust-adapter-gateway-draft",
    },
    {
      from: "autonomous-agent-tier",
      to: "core-seat-arr-base",
      predicate: "GATED_BY_METRIC",
      domainKey: "corporate_strategy",
      weight: 92,
      evidence: "Hybrid seat + outcome credits prevent cannibalization of $82M seat ARR.",
      classificationLevel: "confidential",
      aclReadRoles: ["CEO", "CFO", "CTO", "COO"],
      docSlug: "strat-504-agentic-tier-outcome-pricing-draft",
    },
    {
      from: "autonomous-agent-tier",
      to: "eu-ai-act-acl-policy",
      predicate: "GOVERNED_BY_POLICY",
      domainKey: "governance",
      weight: 90,
      evidence: "Enforces role-based ACLs and separation of enterprise KB from agent memory.",
      classificationLevel: "internal",
      aclReadRoles: ["CEO", "CTO", "CFO", "COO", "EXTERNAL_AGENT"],
      docSlug: "pol-402-eu-gdpr-dora-ai-governance",
    },
    {
      from: "project-kestrel-acquisition",
      to: "zero-trust-adapter-gateway",
      predicate: "INTEGRATES_WITH",
      domainKey: "corporate_strategy",
      weight: 94,
      evidence: "Isolates Kestrel runtime behind zero-trust gateway in 45-day PMI gate.",
      classificationLevel: "board_restricted",
      aclReadRoles: ["CEO", "CFO"],
      docSlug: "memo-501-project-kestrel-ma-term-sheet",
    },
    {
      from: "project-kestrel-acquisition",
      to: "gross-margin-floor-kpi",
      predicate: "GATED_BY_METRIC",
      domainKey: "finance",
      weight: 93,
      evidence: "$6M earnout caps Year-1 EBITDA dilution at 110 bps; accretive Month 14.",
      classificationLevel: "board_restricted",
      aclReadRoles: ["CEO", "CFO"],
      docSlug: "memo-501-project-kestrel-ma-term-sheet",
    },
  ];

  for (const r of relSeeds) {
    const s = entityMap.get(r.from);
    const t = entityMap.get(r.to);
    if (!s || !t) continue;
    tx.insert(ekRelationships).values({
      sourceEntityId: s.id,
      targetEntityId: t.id,
      predicate: r.predicate,
      domainKey: r.domainKey,
      isCrossDomain: s.domainKey !== t.domainKey,
      weight: r.weight,
      evidence: r.evidence,
      classificationLevel: r.classificationLevel,
      aclReadRoles: r.aclReadRoles,
      sourceDocumentId: docId(r.docSlug),
    }).run();
  }
}
