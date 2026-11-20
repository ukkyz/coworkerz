import { getMember, RosterError } from "./executive-profile-store";
import { isActive } from "./roster";
import { isExecutiveRole } from "./executives";
import crypto from "crypto";
import { writeTaxonomyMirrors } from "./taxonomy-mirrors";
import type { NextRequest } from "next/server";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ceoPersona,
  conversationMessages,
  ekApiKeys,
  ekChunks,
  ekDocuments,
  ekDomains,
  ekEntities,
  ekRelationships,
  ekTaxonomySchemes,
  executiveMemories,
  knowledgeEntries,
  type ClearanceLevel,
  type DocumentClassificationTag,
  type EkDocument,
  type EkDomain,
  type EkEntity,
  type EkRelationship,
  type EkTaxonomyScheme,
  type EnterpriseDocMetadata,
  type PrincipalRole,
} from "@/db/schema";
import { getActiveOpencodeConfig } from "./opencode-config";
import {
  autoClassifyDocument,
  chunkDocumentContent,
  classifyWithSkosScheme,
  computeSemanticEmbedding,
  cosineSimilarity,
  exportSkosTurtle,
  lexicalBm25Score,
  parseTaxonomyYaml,
  slugifyKey,
  tokenize,
} from "./enterprise-taxonomy";
import { tryLiveOpencodeCompletion } from "./opencode";

const CLEARANCE_RANK: Record<ClearanceLevel, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  board_restricted: 3,
};

const DEFAULT_ROLE_CLEARANCE: Record<"CEO" | "CTO" | "CFO" | "COO" | "EXTERNAL_AGENT", ClearanceLevel> = {
  CEO: "board_restricted",
  CFO: "board_restricted",
  CTO: "confidential",
  COO: "confidential",
  EXTERNAL_AGENT: "internal",
};

export interface AccessPrincipal {
  authType: "ceo-session" | "role-simulation" | "api-key" | "anonymous";
  role: PrincipalRole;
  clearance: ClearanceLevel;
  allowedDomains: string[]; // ['*'] or domain keys
  canWrite: boolean;
  canReadAgentMemory: boolean;
  keyName?: string;
  keyId?: number;
}

// ============================================================================
// ACL & EXTERNAL AI TOOL AUTHENTICATION
// ============================================================================
function normalizeClearance(val: string | undefined | null): ClearanceLevel {
  if (
    val === "public" ||
    val === "internal" ||
    val === "confidential" ||
    val === "board_restricted"
  ) {
    return val;
  }
  return "internal";
}

/** Resolve the membership and its policy from a single roster row. Never derive authority from a title. */
function lookupRights(
  value: string,
  authType: AccessPrincipal["authType"],
): { principal: AccessPrincipal; capped: boolean } | null {
  if (value === "CEO" || value === "EXTERNAL_AGENT") {
    return {
      capped: false,
      principal: {
        authType,
        role: value,
        clearance: DEFAULT_ROLE_CLEARANCE[value],
        allowedDomains: ["*"],
        canWrite: value === "CEO",
        canReadAgentMemory: value === "CEO",
      },
    };
  }
  const member = getMember(value);
  if (!member || !isActive(member)) return null;
  const id = member.id;
  const legacy = member.preset === "legacy" && isExecutiveRole(id);
  const reader =
    member.preset === "internal" || member.preset === "confidential" ? member.preset : null;
  return {
    capped: !legacy,
    principal: {
      authType,
      role: member.id,
      clearance: legacy ? DEFAULT_ROLE_CLEARANCE[id] : (reader ?? "public"),
      allowedDomains: legacy || reader ? ["*"] : [],
      canWrite: legacy,
      canReadAgentMemory: false,
    },
  };
}

function denied(
  authType: AccessPrincipal["authType"],
  role: PrincipalRole = "EXTERNAL_AGENT",
): AccessPrincipal {
  return {
    authType,
    role,
    clearance: "public",
    allowedDomains: [],
    canWrite: false,
    canReadAgentMemory: false,
  };
}

/** The fail-closed principal. Anonymous callers hold no domains, so no records resolve. */
export function denyAnonymous(): AccessPrincipal {
  return denied("anonymous", "EXTERNAL_AGENT");
}
export function makeRolePrincipal(
  role: PrincipalRole,
  authType: AccessPrincipal["authType"] = "role-simulation",
): AccessPrincipal {
  return lookupRights(role, authType)?.principal ?? denied(authType, role);
}

/**
 * Resolve the membership and its policy from a single roster row. Never derive authority
 * from a title, and never from the absence of a credential.
 *
 * `asCeoSession` must be set by the caller only after it has verified a signed session
 * cookie. It is no longer inferred from a missing header, which is what made the console
 * answer anonymous internet callers as the CEO.
 */
export async function resolvePrincipal(
  req: NextRequest,
  bodyRole?: string,
  options: { asCeoSession?: boolean } = {},
): Promise<{ principal: AccessPrincipal; error?: string }> {
  const auth = req.headers.get("authorization") ?? "";
  const key = (
    req.headers.get("x-api-key") || (/^Bearer /i.test(auth) ? auth.slice(7) : "")
  ).trim();
  if (req.headers.has("authorization") || req.headers.has("x-api-key")) {
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    const row = key && db.select().from(ekApiKeys).where(eq(ekApiKeys.keyHash, hash)).get();
    const rights = row && !row.revoked && lookupRights(row.assignedRole, "api-key");
    if (!row || !rights)
      return {
        principal: denied("api-key"),
        error: "Invalid, revoked or inactive Enterprise Knowledge key.",
      };
    db.update(ekApiKeys)
      .set({ requestCount: sql`${ekApiKeys.requestCount} + 1`, lastUsedAt: new Date() })
      .where(eq(ekApiKeys.id, row.id))
      .run();
    const { capped, principal } = rights;
    const clearance = normalizeClearance(row.clearanceLevel);
    // Pre-roster credentials retain their existing semantics (including empty scope = all).
    const keyDomains = row.allowedDomains.length || capped ? row.allowedDomains : ["*"];
    return {
      principal: {
        ...principal,
        clearance:
          capped && CLEARANCE_RANK[principal.clearance] < CLEARANCE_RANK[clearance]
            ? principal.clearance
            : clearance,
        allowedDomains: principal.allowedDomains.length ? keyDomains : [],
        canWrite: !capped && row.canWrite,
        canReadAgentMemory: !capped && row.canReadAgentMemory,
        keyName: row.name,
        keyId: row.id,
      },
    };
  }
  const requested =
    req.nextUrl.searchParams.get("asRole") ?? req.headers.get("x-simulate-role") ?? bodyRole;
  if (requested !== undefined) {
    const id = requested.trim().toLowerCase();
    const rights = lookupRights(id.startsWith("exec-") ? id : id.toUpperCase(), "role-simulation");
    return rights
      ? { principal: rights.principal }
      : { principal: denied("role-simulation"), error: "Unknown or retired principal." };
  }
  // Fail closed. A trusted-CEO console is a claim the caller must prove, not a default.
  if (!options.asCeoSession) {
    return { principal: denyAnonymous(), error: "Sign in required." };
  }
  return { principal: makeRolePrincipal("CEO", "ceo-session") };
}

/** No-access callers do not receive even taxonomy, domain metadata or redaction counts. */
export async function resolveEnterprisePrincipal(req: NextRequest, bodyRole?: string) {
  const auth = await resolvePrincipal(req, bodyRole);
  if (auth.error) return { ...auth, status: 401 };
  if (!auth.principal.allowedDomains.length)
    return { ...auth, error: "No enterprise access in this scope.", status: 403 };
  return { ...auth, status: 200 };
}

export function canPrincipalRead(
  principal: AccessPrincipal,
  item: {
    domainKey: string;
    classificationLevel: string;
    aclReadRoles: string[];
  }
): boolean {
  // Domain scope check (for domain-scoped API keys)
  if (
    !principal.allowedDomains.includes("*") &&
    !principal.allowedDomains.includes(item.domainKey)
  ) {
    return false;
  }

  // CEO session with unrestricted domain always has full visibility
  if (principal.role === "CEO" && principal.clearance === "board_restricted") {
    return true;
  }

  // Clearance level check
  if (!Object.hasOwn(CLEARANCE_RANK, item.classificationLevel)) return false;
  const itemRank = CLEARANCE_RANK[item.classificationLevel as ClearanceLevel];
  const callerRank = CLEARANCE_RANK[principal.clearance];
  if (callerRank < itemRank) return false;

  // Explicit ACL role list check
  const roles = Array.isArray(item.aclReadRoles) ? item.aclReadRoles : [];
  return roles.includes("*") || roles.includes(principal.role);
}

// ============================================================================
// TAXONOMY MANAGEMENT (YAML + SKOS/OWL TURTLE)
// ============================================================================
export async function getActiveTaxonomyScheme(): Promise<EkTaxonomyScheme> {
  const [scheme] = await db
    .select()
    .from(ekTaxonomySchemes)
    .orderBy(desc(ekTaxonomySchemes.id))
    .limit(1);
  if (!scheme) throw new Error("Enterprise taxonomy is missing. Run npm run db:setup before starting Coworkerz.");
  return scheme;
}

export async function updateTaxonomyScheme(params: {
  yamlContent: string;
  updatedBy?: string;
  reclassifyAll?: boolean;
}): Promise<{
  scheme: EkTaxonomyScheme;
  warnings: string[];
  reclassifiedCount: number;
}> {
  const parsed = parseTaxonomyYaml(params.yamlContent);
  const current = await getActiveTaxonomyScheme();
  const nextVersion = (current?.version || 0) + 1;
  const turtle = exportSkosTurtle({
    schemeUri: parsed.schemeUri,
    title: parsed.title,
    version: nextVersion,
    concepts: parsed.concepts,
    objectProperties: parsed.objectProperties,
  });

  const [saved] = await db
    .insert(ekTaxonomySchemes)
    .values({
      schemeUri: parsed.schemeUri,
      title: parsed.title,
      version: nextVersion,
      format: "yaml-skos",
      yamlContent: params.yamlContent,
      skosTurtle: turtle,
      parsedConcepts: parsed.concepts,
      updatedBy: params.updatedBy || "CEO",
      updatedAt: new Date(),
    })
    .returning();

  await writeTaxonomyMirrors(saved);

  let reclassifiedCount = 0;
  if (params.reclassifyAll) {
    const docs = await db.select().from(ekDocuments);
    for (const doc of docs) {
      const res = classifyWithSkosScheme({
        title: doc.title,
        content: doc.content,
        concepts: parsed.concepts,
      });
      await db
        .update(ekDocuments)
        .set({
          taxonomyConcepts: res.tags,
          secondaryDomains: res.secondaryDomains.filter(
            (d) => d !== doc.domainKey
          ),
          reviewStatus:
            doc.reviewStatus === "approved" ? "pending_review" : doc.reviewStatus,
          updatedAt: new Date(),
        })
        .where(eq(ekDocuments.id, doc.id));
      reclassifiedCount++;
    }
  }

  return { scheme: saved, warnings: parsed.warnings, reclassifiedCount };
}

// ============================================================================
// DOCUMENT INGESTION, AUTO-CLASSIFICATION & HUMAN-IN-THE-LOOP REVIEW
// ============================================================================
export async function ingestEnterpriseDocument(params: {
  title: string;
  content: string;
  docType?: string;
  domainKey?: string; // optional — auto-assigned by SKOS classifier if omitted or 'auto'
  classificationLevel?: ClearanceLevel;
  aclReadRoles?: string[];
  aclWriteRoles?: string[];
  metadata?: EnterpriseDocMetadata;
  autoApprove?: boolean;
  extractGraph?: boolean;
}): Promise<{
  document: EkDocument;
  chunkCount: number;
  createdEntities: number;
  createdRelationships: number;
}> {
  const [scheme, config, domains] = await Promise.all([
    getActiveTaxonomyScheme(),
    getActiveOpencodeConfig(),
    db.select().from(ekDomains),
  ]);
  const domainMap = new Map(domains.map((d) => [d.key, d]));

  const classified = await autoClassifyDocument({
    title: params.title,
    content: params.content,
    concepts: scheme.parsedConcepts,
    config,
  });

  const resolvedDomain =
    params.domainKey &&
    params.domainKey !== "auto" &&
    domainMap.has(params.domainKey)
      ? params.domainKey
      : domainMap.has(classified.suggestedDomain)
      ? classified.suggestedDomain
      : "corporate_strategy";

  const domDefaults = domainMap.get(resolvedDomain)!;
  const clearance = normalizeClearance(
    params.classificationLevel || domDefaults.defaultClearance
  );
  const aclRead =
    Array.isArray(params.aclReadRoles) && params.aclReadRoles.length > 0
      ? Array.from(new Set(["CEO", ...params.aclReadRoles]))
      : domDefaults.aclReadRoles;
  const aclWrite =
    Array.isArray(params.aclWriteRoles) && params.aclWriteRoles.length > 0
      ? Array.from(new Set(["CEO", ...params.aclWriteRoles]))
      : domDefaults.aclWriteRoles;

  const baseSlug = slugifyKey(params.title);
  const uniqueSlug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
  const embedding = computeSemanticEmbedding(
    `${params.title}. ${params.content}`
  );

  const approveNow = Boolean(params.autoApprove);

  const [doc] = await db
    .insert(ekDocuments)
    .values({
      slug: uniqueSlug,
      title: params.title.trim(),
      docType: (params.docType || "policy").trim(),
      domainKey: resolvedDomain,
      secondaryDomains: classified.secondaryDomains.filter(
        (d) => d !== resolvedDomain && domainMap.has(d)
      ),
      summary: classified.summary,
      content: params.content.trim(),
      classificationLevel: clearance,
      aclReadRoles: aclRead,
      aclWriteRoles: aclWrite,
      metadata: {
        author: "CEO / Enterprise Ingest",
        version: "1.0",
        effectiveDate: new Date().toISOString().slice(0, 10),
        ...params.metadata,
      },
      taxonomyConcepts: classified.tags,
      classifierMode: classified.classifierMode,
      reviewStatus: approveNow ? "approved" : "pending_review",
      reviewedBy: approveNow ? "CEO" : null,
      reviewerNotes: approveNow ? "Direct CEO approval on ingest." : null,
      reviewedAt: approveNow ? new Date() : null,
      embedding,
    })
    .returning();

  const chunks = chunkDocumentContent(doc.title, doc.content);
  if (chunks.length > 0) {
    await db.insert(ekChunks).values(
      chunks.map((c) => ({
        documentId: doc.id,
        domainKey: resolvedDomain,
        chunkIndex: c.chunkIndex,
        heading: c.heading,
        content: c.content,
        tokenCount: c.tokenCount,
        embedding: c.embedding,
      }))
    );
  }

  let createdEntities = 0;
  let createdRelationships = 0;

  if (params.extractGraph !== false) {
    const nameToEntity = new Map<string, EkEntity>();
    for (const ent of classified.extractedEntities) {
      const eDomain = domainMap.has(ent.domainKey)
        ? ent.domainKey
        : resolvedDomain;
      const cKey = slugifyKey(ent.name);
      const [existing] = await db
        .select()
        .from(ekEntities)
        .where(eq(ekEntities.canonicalKey, cKey))
        .limit(1);

      if (existing) {
        nameToEntity.set(ent.name.toLowerCase(), existing);
      } else {
        const [inserted] = await db
          .insert(ekEntities)
          .values({
            canonicalKey: cKey,
            name: ent.name,
            entityType: ent.entityType || "Initiative",
            domainKey: eDomain,
            taxonomyConceptId: ent.taxonomyConceptId,
            description: ent.description,
            attributes: ent.attributes || {},
            classificationLevel: clearance,
            aclReadRoles: aclRead,
            sourceDocumentId: doc.id,
          })
          .returning();
        nameToEntity.set(ent.name.toLowerCase(), inserted);
        createdEntities++;
      }
    }

    for (const rel of classified.extractedRelationships) {
      const sEnt = nameToEntity.get(rel.sourceName.toLowerCase());
      const tEnt = nameToEntity.get(rel.targetName.toLowerCase());
      if (!sEnt || !tEnt || sEnt.id === tEnt.id) continue;
      const rDomain = domainMap.has(rel.domainKey)
        ? rel.domainKey
        : resolvedDomain;
      await db.insert(ekRelationships).values({
        sourceEntityId: sEnt.id,
        targetEntityId: tEnt.id,
        predicate: rel.predicate || "INTEGRATES_WITH",
        domainKey: rDomain,
        isCrossDomain: sEnt.domainKey !== tEnt.domainKey,
        weight: 85,
        evidence: rel.evidence,
        classificationLevel: clearance,
        aclReadRoles: aclRead,
        sourceDocumentId: doc.id,
      });
      createdRelationships++;
    }
  }

  return {
    document: doc,
    chunkCount: chunks.length,
    createdEntities,
    createdRelationships,
  };
}

export async function reviewEnterpriseDocument(params: {
  documentId: number;
  reviewStatus?: "approved" | "pending_review" | "rejected";
  conceptIds?: string[]; // optional human override of SKOS concept IDs
  domainKey?: string;
  classificationLevel?: ClearanceLevel;
  aclReadRoles?: string[];
  reviewerNotes?: string;
  reviewedBy?: string;
}): Promise<EkDocument | null> {
  const [existing] = await db
    .select()
    .from(ekDocuments)
    .where(eq(ekDocuments.id, params.documentId))
    .limit(1);
  if (!existing) return null;

  let nextTags: DocumentClassificationTag[] = existing.taxonomyConcepts;
  let classifierMode = existing.classifierMode;

  if (Array.isArray(params.conceptIds)) {
    const scheme = await getActiveTaxonomyScheme();
    const map = new Map(scheme.parsedConcepts.map((c) => [c.id, c]));
    const prevMap = new Map(
      existing.taxonomyConcepts.map((t) => [t.conceptId, t])
    );
    nextTags = params.conceptIds
      .map((id) => {
        const c = map.get(id);
        if (!c) return null;
        const prev = prevMap.get(id);
        return {
          conceptId: c.id,
          prefLabel: c.prefLabel,
          domainKey: c.domainKey,
          uri: c.uri,
          confidence: prev ? Math.max(prev.confidence, 95) : 100,
          matchedSignals: prev ? prev.matchedSignals : ["ceo-curated"],
          origin: prev ? prev.origin : ("human-reviewer" as const),
        };
      })
      .filter((x): x is DocumentClassificationTag => x !== null);
    classifierMode = "human-curated";
  }

  const nextDomain = params.domainKey || existing.domainKey;
  const nextSecondary = Array.from(
    new Set(nextTags.map((t) => t.domainKey).filter((d) => d !== nextDomain))
  );
  const nextAcl =
    Array.isArray(params.aclReadRoles) && params.aclReadRoles.length > 0
      ? Array.from(new Set(["CEO", ...params.aclReadRoles]))
      : existing.aclReadRoles;
  const nextClearance = params.classificationLevel
    ? normalizeClearance(params.classificationLevel)
    : existing.classificationLevel;
  const nextStatus = params.reviewStatus || existing.reviewStatus;

  const [updated] = await db
    .update(ekDocuments)
    .set({
      domainKey: nextDomain,
      secondaryDomains: nextSecondary,
      taxonomyConcepts: nextTags,
      classifierMode,
      classificationLevel: nextClearance,
      aclReadRoles: nextAcl,
      reviewStatus: nextStatus,
      reviewedBy: params.reviewedBy || "CEO",
      reviewerNotes:
        params.reviewerNotes !== undefined
          ? params.reviewerNotes
          : existing.reviewerNotes,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(ekDocuments.id, existing.id))
    .returning();

  if (nextDomain !== existing.domainKey) {
    await db
      .update(ekChunks)
      .set({ domainKey: nextDomain })
      .where(eq(ekChunks.documentId, existing.id));
  }

  return updated;
}

// ============================================================================
// DOMAIN-TAGGED & CROSS-DOMAIN KNOWLEDGE GRAPH SERVICE
// ============================================================================
export interface EnrichedRelationship extends EkRelationship {
  sourceName: string;
  sourceDomain: string;
  targetName: string;
  targetDomain: string;
}

export async function queryKnowledgeGraph(params: {
  principal: AccessPrincipal;
  domain?: string | null; // single domain subgraph, or 'ALL'
  domains?: string[]; // multiple domains
  includeCrossDomainBridges?: boolean;
  onlyCrossDomain?: boolean;
  seedQuery?: string | null;
  hops?: number;
}): Promise<{
  domains: EkDomain[];
  entities: EkEntity[];
  relationships: EnrichedRelationship[];
  stats: {
    visibleEntities: number;
    visibleRelationships: number;
    crossDomainRelationships: number;
    aclRedactedEntities: number;
    aclRedactedRelationships: number;
    entitiesPerDomain: Record<string, number>;
  };
}> {
  const [domains, allEntities, allRels] = await Promise.all([
    db.select().from(ekDomains).orderBy(asc(ekDomains.id)),
    db.select().from(ekEntities).orderBy(asc(ekEntities.id)),
    db.select().from(ekRelationships).orderBy(asc(ekRelationships.id)),
  ]);

  // 1. Enforce ACL on every entity and relationship
  const permittedEntities = allEntities.filter((e) =>
    canPrincipalRead(params.principal, e)
  );
  const permittedEntityMap = new Map(permittedEntities.map((e) => [e.id, e]));
  const aclRedactedEntities = allEntities.length - permittedEntities.length;

  const permittedRels: EnrichedRelationship[] = [];
  let aclRedactedRelationships = 0;

  for (const r of allRels) {
    const src = permittedEntityMap.get(r.sourceEntityId);
    const tgt = permittedEntityMap.get(r.targetEntityId);
    if (!src || !tgt || !canPrincipalRead(params.principal, r)) {
      aclRedactedRelationships++;
      continue;
    }
    permittedRels.push({
      ...r,
      isCrossDomain: src.domainKey !== tgt.domainKey,
      sourceName: src.name,
      sourceDomain: src.domainKey,
      targetName: tgt.name,
      targetDomain: tgt.domainKey,
    });
  }

  const entitiesPerDomain: Record<string, number> = {};
  for (const d of domains) entitiesPerDomain[d.key] = 0;
  for (const e of permittedEntities) {
    entitiesPerDomain[e.domainKey] = (entitiesPerDomain[e.domainKey] || 0) + 1;
  }

  // 2. Filter by domain subgraph (with optional cross-domain bridge nodes/edges!)
  const domainFilterSet = new Set<string>();
  if (params.domain && params.domain !== "ALL") {
    domainFilterSet.add(params.domain);
  }
  if (Array.isArray(params.domains)) {
    for (const d of params.domains) {
      if (d && d !== "ALL") domainFilterSet.add(d);
    }
  }

  const includeBridges = params.includeCrossDomainBridges !== false;
  let filteredEntities = permittedEntities;
  let filteredRels = permittedRels;

  if (domainFilterSet.size > 0) {
    if (includeBridges) {
      filteredRels = permittedRels.filter(
        (r) =>
          domainFilterSet.has(r.domainKey) ||
          domainFilterSet.has(r.sourceDomain) ||
          domainFilterSet.has(r.targetDomain)
      );
      const keepIds = new Set<number>(
        permittedEntities
          .filter((e) => domainFilterSet.has(e.domainKey))
          .map((e) => e.id)
      );
      for (const r of filteredRels) {
        keepIds.add(r.sourceEntityId);
        keepIds.add(r.targetEntityId);
      }
      filteredEntities = permittedEntities.filter((e) => keepIds.has(e.id));
    } else {
      // Pure isolated domain subgraph
      filteredEntities = permittedEntities.filter((e) =>
        domainFilterSet.has(e.domainKey)
      );
      const keepIds = new Set(filteredEntities.map((e) => e.id));
      filteredRels = permittedRels.filter(
        (r) => keepIds.has(r.sourceEntityId) && keepIds.has(r.targetEntityId)
      );
    }
  }

  if (params.onlyCrossDomain) {
    filteredRels = filteredRels.filter((r) => r.isCrossDomain);
    const keepIds = new Set<number>();
    for (const r of filteredRels) {
      keepIds.add(r.sourceEntityId);
      keepIds.add(r.targetEntityId);
    }
    filteredEntities = filteredEntities.filter((e) => keepIds.has(e.id));
  }

  // 3. Optional multi-hop BFS traversal across domains from seed query
  if (params.seedQuery && params.seedQuery.trim().length > 0) {
    const qTerms = tokenize(params.seedQuery);
    const qLower = params.seedQuery.toLowerCase();
    const maxHops = Math.min(3, Math.max(1, Number(params.hops) || 2));

    const seedIds = new Set<number>();
    for (const e of filteredEntities) {
      const hay = `${e.name} ${e.entityType} ${e.domainKey} ${e.description} ${Object.values(
        e.attributes || {}
      ).join(" ")}`.toLowerCase();
      if (
        hay.includes(qLower) ||
        qTerms.some((t) => t.length >= 3 && hay.includes(t))
      ) {
        seedIds.add(e.id);
      }
    }

    if (seedIds.size > 0) {
      const visited = new Set<number>(seedIds);
      let frontier = new Set<number>(seedIds);
      const traversedRelIds = new Set<number>();

      for (let hop = 0; hop < maxHops; hop++) {
        const nextFrontier = new Set<number>();
        for (const r of filteredRels) {
          if (frontier.has(r.sourceEntityId)) {
            traversedRelIds.add(r.id);
            if (!visited.has(r.targetEntityId)) {
              visited.add(r.targetEntityId);
              nextFrontier.add(r.targetEntityId);
            }
          }
          if (frontier.has(r.targetEntityId)) {
            traversedRelIds.add(r.id);
            if (!visited.has(r.sourceEntityId)) {
              visited.add(r.sourceEntityId);
              nextFrontier.add(r.sourceEntityId);
            }
          }
        }
        frontier = nextFrontier;
        if (frontier.size === 0) break;
      }

      filteredEntities = filteredEntities.filter((e) => visited.has(e.id));
      filteredRels = filteredRels.filter((r) => traversedRelIds.has(r.id));
    }
  }

  return {
    domains,
    entities: filteredEntities,
    relationships: filteredRels,
    stats: {
      visibleEntities: filteredEntities.length,
      visibleRelationships: filteredRels.length,
      crossDomainRelationships: filteredRels.filter((r) => r.isCrossDomain)
        .length,
      aclRedactedEntities,
      aclRedactedRelationships,
      entitiesPerDomain,
    },
  };
}

export async function createGraphEntity(params: {
  name: string;
  entityType: string;
  domainKey: string;
  taxonomyConceptId?: string | null;
  description: string;
  attributes?: Record<string, string>;
  classificationLevel?: ClearanceLevel;
  aclReadRoles?: string[];
}): Promise<EkEntity> {
  const key = `${slugifyKey(params.name)}-${Date.now().toString(36).slice(-3)}`;
  const acl =
    Array.isArray(params.aclReadRoles) && params.aclReadRoles.length > 0
      ? Array.from(new Set(["CEO", ...params.aclReadRoles]))
      : ["CEO"];
  const [created] = await db
    .insert(ekEntities)
    .values({
      canonicalKey: key,
      name: params.name.trim(),
      entityType: params.entityType.trim() || "Initiative",
      domainKey: params.domainKey,
      taxonomyConceptId: params.taxonomyConceptId || null,
      description: params.description.trim(),
      attributes: params.attributes || {},
      classificationLevel: normalizeClearance(params.classificationLevel),
      aclReadRoles: acl,
    })
    .returning();
  return created;
}

export async function createGraphRelationship(params: {
  sourceEntityId: number;
  targetEntityId: number;
  predicate: string;
  domainKey: string;
  evidence?: string;
  weight?: number;
  classificationLevel?: ClearanceLevel;
  aclReadRoles?: string[];
}): Promise<EkRelationship> {
  const [src] = await db
    .select()
    .from(ekEntities)
    .where(eq(ekEntities.id, params.sourceEntityId))
    .limit(1);
  const [tgt] = await db
    .select()
    .from(ekEntities)
    .where(eq(ekEntities.id, params.targetEntityId))
    .limit(1);
  if (!src || !tgt) {
    throw new Error("Both sourceEntityId and targetEntityId must exist.");
  }

  const acl =
    Array.isArray(params.aclReadRoles) && params.aclReadRoles.length > 0
      ? Array.from(new Set(["CEO", ...params.aclReadRoles]))
      : ["CEO"];

  const [created] = await db
    .insert(ekRelationships)
    .values({
      sourceEntityId: src.id,
      targetEntityId: tgt.id,
      predicate: params.predicate
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, "_"),
      domainKey: params.domainKey || src.domainKey,
      isCrossDomain: src.domainKey !== tgt.domainKey,
      weight: Math.min(100, Math.max(10, Number(params.weight) || 88)),
      evidence: (params.evidence || "").trim(),
      classificationLevel: normalizeClearance(params.classificationLevel),
      aclReadRoles: acl,
    })
    .returning();
  return created;
}

// ============================================================================
// HYBRID RETRIEVAL (ACL + BM25 + 128d VECTOR + SKOS EXPANSION + GRAPHRAG)
// ============================================================================
export interface EnterpriseRetrievalPassage {
  chunkId: number;
  documentId: number;
  documentTitle: string;
  docType: string;
  domainKey: string;
  heading: string;
  content: string;
  classificationLevel: string;
  reviewStatus: string;
  taxonomyConcepts: string[];
  scores: {
    combined: number;
    vector: number;
    lexical: number;
    taxonomyBoost: number;
  };
  matchedTerms: string[];
}

export async function retrieveEnterpriseKnowledge(params: {
  query: string;
  principal: AccessPrincipal;
  domains?: string[]; // empty = cross-domain across all authorized KBs
  topK?: number;
  includePendingReview?: boolean;
  includeGraph?: boolean;
  graphHops?: number;
  synthesizeAnswer?: boolean;
  includeSeparateAgentMemory?: boolean;
}) {
  const query = params.query.trim();
  const topK = Math.min(12, Math.max(1, Number(params.topK) || 5));
  const includePending =
    params.includePendingReview ?? params.principal.role === "CEO";
  const includeGraph = params.includeGraph !== false;

  const [scheme, allDocs, allChunks] = await Promise.all([
    getActiveTaxonomyScheme(),
    db.select().from(ekDocuments),
    db.select().from(ekChunks),
  ]);

  // 1. Detect SKOS concepts in query & expand via altLabels + cross-domain skos:related!
  const queryClassified = classifyWithSkosScheme({
    title: query,
    content: query,
    concepts: scheme.parsedConcepts,
    maxTags: 3,
  });
  const matchedConceptIds = new Set(queryClassified.tags.map((t) => t.conceptId));
  const relatedConceptIds = new Set<string>();
  const expandedTerms: string[] = [];

  for (const tag of queryClassified.tags) {
    const c = scheme.parsedConcepts.find((x) => x.id === tag.conceptId);
    if (!c) continue;
    expandedTerms.push(...c.altLabels.slice(0, 3));
    for (const relId of c.related) {
      relatedConceptIds.add(relId);
      const rc = scheme.parsedConcepts.find((x) => x.id === relId);
      if (rc) expandedTerms.push(rc.prefLabel, ...rc.altLabels.slice(0, 2));
    }
  }

  // 2. ACL & Domain & Review Status Pre-Filtering
  const requestedDomains =
    Array.isArray(params.domains) &&
    params.domains.filter((d) => d && d !== "ALL").length > 0
      ? new Set(params.domains.filter((d) => d && d !== "ALL"))
      : null;

  let aclRedactedDocuments = 0;
  const redactedTitlesHint: Array<{ domainKey: string; classificationLevel: string }> =
    [];
  const authorizedDocMap = new Map<number, EkDocument>();

  for (const doc of allDocs) {
    if (
      requestedDomains &&
      !requestedDomains.has(doc.domainKey) &&
      !(doc.secondaryDomains || []).some((sd) => requestedDomains.has(sd))
    ) {
      continue;
    }
    if (!canPrincipalRead(params.principal, doc)) {
      aclRedactedDocuments++;
      redactedTitlesHint.push({
        domainKey: doc.domainKey,
        classificationLevel: doc.classificationLevel,
      });
      continue;
    }
    if (doc.reviewStatus === "rejected") continue;
    if (doc.reviewStatus === "pending_review" && !includePending) continue;
    authorizedDocMap.set(doc.id, doc);
  }

  // 3. Hybrid Vector + BM25 + SKOS Taxonomy Scoring over Authorized Chunks
  const qVec = computeSemanticEmbedding(query);
  const qTokens = tokenize(query);

  const scoredPassages: EnterpriseRetrievalPassage[] = [];
  for (const ch of allChunks) {
    const doc = authorizedDocMap.get(ch.documentId);
    if (!doc) continue;

    const vecScore = cosineSimilarity(qVec, ch.embedding || []);
    const lex = lexicalBm25Score(
      qTokens,
      `${doc.title} ${ch.heading} ${ch.content}`,
      expandedTerms
    );

    const docConceptIds = (doc.taxonomyConcepts || []).map((t) => t.conceptId);
    let taxBoost = 0;
    for (const cid of docConceptIds) {
      if (matchedConceptIds.has(cid)) taxBoost += 0.14;
      else if (relatedConceptIds.has(cid)) taxBoost += 0.08;
    }
    taxBoost = Math.min(0.26, taxBoost);

    const approvalBoost = doc.reviewStatus === "approved" ? 0.03 : 0;
    const combined = Math.min(
      0.99,
      lex.score * 0.52 + vecScore * 0.34 + taxBoost + approvalBoost
    );

    if (combined >= 0.08 || scoredPassages.length < 2) {
      scoredPassages.push({
        chunkId: ch.id,
        documentId: doc.id,
        documentTitle: doc.title,
        docType: doc.docType,
        domainKey: doc.domainKey,
        heading: ch.heading,
        content: ch.content,
        classificationLevel: doc.classificationLevel,
        reviewStatus: doc.reviewStatus,
        taxonomyConcepts: docConceptIds,
        scores: {
          combined: Math.round(combined * 1000) / 1000,
          vector: Math.round(vecScore * 1000) / 1000,
          lexical: Math.round(lex.score * 1000) / 1000,
          taxonomyBoost: Math.round(taxBoost * 1000) / 1000,
        },
        matchedTerms: lex.matchedTerms,
      });
    }
  }

  scoredPassages.sort((a, b) => b.scores.combined - a.scores.combined);
  const topPassages = scoredPassages.slice(0, topK);

  // 4. Cross-Domain Multi-Hop Knowledge Graph Traversal
  let graphContext: {
    entities: Array<{
      id: number;
      name: string;
      entityType: string;
      domainKey: string;
      classificationLevel: string;
      description: string;
      attributes: Record<string, string>;
    }>;
    triples: Array<{
      id: number;
      subject: string;
      subjectDomain: string;
      predicate: string;
      object: string;
      objectDomain: string;
      edgeDomain: string;
      isCrossDomain: boolean;
      evidence: string;
    }>;
    aclRedactedEntities: number;
  } = { entities: [], triples: [], aclRedactedEntities: 0 };

  if (includeGraph) {
    const kg = await queryKnowledgeGraph({
      principal: params.principal,
      domains: requestedDomains ? Array.from(requestedDomains) : undefined,
      includeCrossDomainBridges: true,
      seedQuery: query,
      hops: params.graphHops ?? 2,
    });

    graphContext = {
      entities: kg.entities.slice(0, 10).map((e) => ({
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        domainKey: e.domainKey,
        classificationLevel: e.classificationLevel,
        description: e.description,
        attributes: e.attributes || {},
      })),
      triples: kg.relationships.slice(0, 12).map((r) => ({
        id: r.id,
        subject: r.sourceName,
        subjectDomain: r.sourceDomain,
        predicate: r.predicate,
        object: r.targetName,
        objectDomain: r.targetDomain,
        edgeDomain: r.domainKey,
        isCrossDomain: r.isCrossDomain,
        evidence: r.evidence,
      })),
      aclRedactedEntities: kg.stats.aclRedactedEntities,
    };
  }

  const domainsTraversed = Array.from(
    new Set([
      ...topPassages.map((p) => p.domainKey),
      ...graphContext.entities.map((e) => e.domainKey),
    ])
  );

  // 5. Grounded Cross-Domain Answer Synthesis (purely from authorized Enterprise KB + KG!)
  let synthesizedAnswer: string | null = null;
  let answerMode: "opencode-live" | "grounded-hybrid-synthesis" =
    "grounded-hybrid-synthesis";

  if (params.synthesizeAnswer !== false) {
    const config = await getActiveOpencodeConfig();
    const passageContext = topPassages
      .slice(0, 4)
      .map(
        (p) =>
          `[Doc #${p.documentId} | ${p.domainKey} | ${p.classificationLevel}] ${p.documentTitle} (${p.heading}): ${p.content}`
      )
      .join("\n");
    const tripleContext = graphContext.triples
      .slice(0, 8)
      .map(
        (t) =>
          `- (${t.subject} [${t.subjectDomain}]) --${t.predicate} [${t.edgeDomain}]--> (${t.object} [${t.objectDomain}]): ${t.evidence}`
      )
      .join("\n");

    const live = await tryLiveOpencodeCompletion({
      config,
      modelDisplayId: getMember(params.principal.role)?.model ?? config.ctoModel,
      maxTokens: 420,
      systemPrompt: `You are the Aether Enterprise Knowledge Retrieval Engine answering for principal role "${params.principal.role}" (clearance: ${params.principal.clearance}).
Answer strictly using the authorized enterprise passages and cross-domain knowledge graph triples below. Cite [Doc #ID] inline and highlight cross-domain dependencies. Keep to 3-5 crisp executive sentences.`,
      userPrompt: `QUERY: ${query}\n\nAUTHORIZED PASSAGES:\n${passageContext || "None"}\n\nKNOWLEDGE GRAPH TRIPLES:\n${tripleContext || "None"}`,
    });

    if (live) {
      synthesizedAnswer = live;
      answerMode = "opencode-live";
    } else {
      synthesizedAnswer = buildGroundedSynthesis({
        principal: params.principal,
        topPassages,
        triples: graphContext.triples,
        domainsTraversed,
        aclRedactedDocuments,
      });
    }
  }

  // 6. Optional STRICTLY SEPARATED Agent Memory Envelope (only if explicitly requested AND permitted!)
  let isolatedAgentMemory: {
    plane: "conversational_agent_memory";
    permitted: boolean;
    reason?: string;
    personaVersion?: number;
    styleHint?: string;
    recentMemories?: Array<{ role: string; type: string; content: string }>;
  } | null = null;

  if (params.includeSeparateAgentMemory) {
    if (!params.principal.canReadAgentMemory) {
      isolatedAgentMemory = {
        plane: "conversational_agent_memory",
        permitted: false,
        reason: `Caller role "${params.principal.role}" does not hold canReadAgentMemory permission. Conversational agent memory remains isolated.`,
      };
    } else {
      const [[persona], mems] = await Promise.all([
        db.select().from(ceoPersona).orderBy(asc(ceoPersona.id)).limit(1),
        db
          .select()
          .from(executiveMemories)
          .orderBy(desc(executiveMemories.id))
          .limit(4),
      ]);
      isolatedAgentMemory = {
        plane: "conversational_agent_memory",
        permitted: true,
        personaVersion: persona?.version ?? 0,
        styleHint: persona?.profile?.styleHint || "",
        recentMemories: mems.map((m) => ({
          role: m.executiveRole,
          type: m.memoryType,
          content: m.content.slice(0, 180),
        })),
      };
    }
  }

  return {
    plane: "enterprise_knowledge" as const,
    agentMemoryIsolated: true,
    principal: {
      role: params.principal.role,
      authType: params.principal.authType,
      clearance: params.principal.clearance,
      allowedDomains: params.principal.allowedDomains,
      keyName: params.principal.keyName || null,
    },
    query,
    skosExpansion: {
      matchedConcepts: queryClassified.tags.map((t) => ({
        conceptId: t.conceptId,
        prefLabel: t.prefLabel,
        domainKey: t.domainKey,
        confidence: t.confidence,
      })),
      relatedCrossDomainConcepts: Array.from(relatedConceptIds),
    },
    aclAudit: {
      authorizedDocumentsSearched: authorizedDocMap.size,
      redactedDocuments: aclRedactedDocuments,
      redactedBreakdown: redactedTitlesHint,
      redactedGraphEntities: graphContext.aclRedactedEntities,
    },
    domainsTraversed,
    crossDomainEdgesUsed: graphContext.triples.filter((t) => t.isCrossDomain)
      .length,
    answer: synthesizedAnswer,
    answerMode,
    passages: topPassages,
    knowledgeGraph: graphContext,
    ...(isolatedAgentMemory ? { isolatedAgentMemory } : {}),
  };
}

function buildGroundedSynthesis(params: {
  principal: AccessPrincipal;
  topPassages: EnterpriseRetrievalPassage[];
  triples: Array<{
    subject: string;
    subjectDomain: string;
    predicate: string;
    object: string;
    objectDomain: string;
    isCrossDomain: boolean;
    evidence: string;
  }>;
  domainsTraversed: string[];
  aclRedactedDocuments: number;
}): string {
  const {
    principal,
    topPassages,
    triples,
    domainsTraversed,
    aclRedactedDocuments,
  } = params;

  if (topPassages.length === 0 && triples.length === 0) {
    return aclRedactedDocuments > 0
      ? `No authorized enterprise documents matched for role ${principal.role} (clearance: ${principal.clearance}). ${aclRedactedDocuments} restricted document(s) were withheld by Enterprise ACL policy.`
      : `No matching enterprise knowledge records found within the authorized scope for ${principal.role}.`;
  }

  const parts: string[] = [];
  for (const p of topPassages.slice(0, 2)) {
    const firstSentence =
      p.content.split(/(?<=[.!?])\s+/)[0] || p.content.slice(0, 180);
    parts.push(
      `[Doc #${p.documentId} · ${p.domainKey}] ${firstSentence}`
    );
  }

  const crossTriples = triples.filter((t) => t.isCrossDomain).slice(0, 2);
  if (crossTriples.length > 0) {
    const chain = crossTriples
      .map(
        (t) =>
          `${t.subject} (${t.subjectDomain}) → ${t.predicate} → ${t.object} (${t.objectDomain})`
      )
      .join("; ");
    parts.push(
      `Cross-domain Knowledge Graph trace across ${domainsTraversed.join(
        ", "
      )}: ${chain}.`
    );
  }

  if (aclRedactedDocuments > 0) {
    parts.push(
      `ACL Notice: ${aclRedactedDocuments} higher-clearance document(s) were filtered out for principal role ${principal.role} (${principal.clearance}).`
    );
  }

  return parts.join(" ");
}

// ============================================================================
// MERMAID MINDMAP SUMMARY VISUALIZER GENERATOR
// ============================================================================
function safeMermaidLabel(raw: string, maxLen = 44): string {
  // Remove characters that carry structural meaning in Mermaid mindmap syntax
  const cleaned = raw
    .replace(/[()[\]{}"'`<>:#;|\\*!@]/g, " ")
    .replace(/&/g, "and")
    .replace(/^\s*[-+]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Item";
  if (cleaned.length <= maxLen) return cleaned;
  const slice = cleaned.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 14 ? slice.slice(0, lastSpace) : slice).trim();
}

export async function generateEnterpriseMindmap(params: {
  principal: AccessPrincipal;
  domainFilter?: string | null;
  includeCrossDomain?: boolean;
}): Promise<{
  mermaidCode: string;
  summary: {
    principalRole: PrincipalRole;
    clearance: ClearanceLevel;
    domainsCount: number;
    conceptsCount: number;
    approvedDocsCount: number;
    pendingDocsCount: number;
    entitiesCount: number;
    relationshipsCount: number;
    crossDomainEdgesCount: number;
    redactedDocsCount: number;
    redactedEntitiesCount: number;
    agentMemorySeparation: {
      enterpriseDocs: number;
      enterpriseEntities: number;
      enterpriseEdges: number;
      conversationalMessages: number;
      agentMemories: number;
      sessionInsights: number;
      personaVersion: number;
    };
  };
}> {
  const [
    domains,
    scheme,
    allDocs,
    kg,
    [{ msgCount }],
    [{ memCount }],
    [{ noteCount }],
    personaRows,
  ] = await Promise.all([
    db.select().from(ekDomains).orderBy(asc(ekDomains.id)),
    getActiveTaxonomyScheme(),
    db.select().from(ekDocuments).orderBy(asc(ekDocuments.id)),
    queryKnowledgeGraph({
      principal: params.principal,
      domain: params.domainFilter || "ALL",
      includeCrossDomainBridges: params.includeCrossDomain !== false,
    }),
    db
      .select({ msgCount: count() })
      .from(conversationMessages),
    db
      .select({ memCount: count() })
      .from(executiveMemories),
    db
      .select({ noteCount: count() })
      .from(knowledgeEntries),
    db.select().from(ceoPersona).orderBy(asc(ceoPersona.id)).limit(1),
  ]);

  const activeDomains =
    params.domainFilter && params.domainFilter !== "ALL"
      ? domains.filter((d) => d.key === params.domainFilter)
      : domains.filter(
          (d) =>
            params.principal.allowedDomains.includes("*") ||
            params.principal.allowedDomains.includes(d.key)
        );

  const visibleDocs = allDocs.filter(
    (d) =>
      canPrincipalRead(params.principal, d) &&
      d.reviewStatus !== "rejected" &&
      (!params.domainFilter ||
        params.domainFilter === "ALL" ||
        d.domainKey === params.domainFilter)
  );
  const redactedDocsCount = allDocs.filter(
    (d) => !canPrincipalRead(params.principal, d)
  ).length;

  const lines: string[] = [
    "mindmap",
    `  root((Aether Enterprise Knowledge OS))`,
  ];

  for (const dom of activeDomains) {
    const domConcepts = scheme.parsedConcepts.filter(
      (c) => c.domainKey === dom.key
    );
    const domDocs = visibleDocs.filter((d) => d.domainKey === dom.key);
    const domEntities = kg.entities.filter((e) => e.domainKey === dom.key);

    lines.push(
      `    ${safeMermaidLabel(`${dom.name} - ${dom.ownerRole}`, 40)}`
    );

    if (domConcepts.length > 0) {
      lines.push(`      SKOS Taxonomy ${domConcepts.length}`);
      for (const c of domConcepts.slice(0, 3)) {
        lines.push(`        ${safeMermaidLabel(c.prefLabel, 34)}`);
      }
    }

    if (domDocs.length > 0) {
      lines.push(`      KB Docs ${domDocs.length}`);
      for (const doc of domDocs.slice(0, 3)) {
        const badge =
          doc.reviewStatus === "pending_review"
            ? "Review "
            : doc.classificationLevel === "board_restricted"
            ? "Board "
            : "";
        const shortTitle = doc.title.replace(/^[A-Z]+-\d+:\s*/i, "");
        lines.push(`        ${safeMermaidLabel(`${badge}${shortTitle}`, 34)}`);
      }
    }

    if (domEntities.length > 0) {
      lines.push(`      KG Entities ${domEntities.length}`);
      for (const ent of domEntities.slice(0, 3)) {
        lines.push(`        ${safeMermaidLabel(ent.name, 34)}`);
      }
    }
  }

  const crossEdges = kg.relationships.filter((r) => r.isCrossDomain);
  if (params.includeCrossDomain !== false && crossEdges.length > 0) {
    lines.push(`    Cross-Domain Bridges ${crossEdges.length}`);
    for (const edge of crossEdges.slice(0, 5)) {
      const predShort = edge.predicate.toLowerCase().replace(/_/g, " ");
      lines.push(
        `      ${safeMermaidLabel(
          `${edge.sourceName.split(" ").slice(0, 2).join(" ")} ${predShort} ${edge.targetName
            .split(" ")
            .slice(0, 2)
            .join(" ")}`,
          42
        )}`
      );
    }
  }

  lines.push(`    Governance and Isolation`);
  lines.push(
    `      ACL Role ${safeMermaidLabel(
      `${params.principal.role} ${params.principal.clearance}`,
      34
    )}`
  );
  lines.push(`      Taxonomy YAML SKOS v${scheme.version}`);
  lines.push(`      Agent Memory Strictly Isolated`);

  return {
    mermaidCode: lines.join("\n"),
    summary: {
      principalRole: params.principal.role,
      clearance: params.principal.clearance,
      domainsCount: activeDomains.length,
      conceptsCount: scheme.parsedConcepts.length,
      approvedDocsCount: visibleDocs.filter((d) => d.reviewStatus === "approved")
        .length,
      pendingDocsCount: visibleDocs.filter(
        (d) => d.reviewStatus === "pending_review"
      ).length,
      entitiesCount: kg.stats.visibleEntities,
      relationshipsCount: kg.stats.visibleRelationships,
      crossDomainEdgesCount: kg.stats.crossDomainRelationships,
      redactedDocsCount,
      redactedEntitiesCount: kg.stats.aclRedactedEntities,
      agentMemorySeparation: {
        enterpriseDocs: allDocs.length,
        enterpriseEntities:
          kg.stats.visibleEntities + kg.stats.aclRedactedEntities,
        enterpriseEdges:
          kg.stats.visibleRelationships + kg.stats.aclRedactedRelationships,
        conversationalMessages: msgCount || 0,
        agentMemories: memCount || 0,
        sessionInsights: noteCount || 0,
        personaVersion: personaRows[0]?.version || 0,
      },
    },
  };
}

// ============================================================================
// SCOPED REST API KEYS FOR EXTERNAL AI MODELS / TOOLS
// ============================================================================
export async function createEnterpriseApiKey(params: {
  name: string;
  assignedRole: PrincipalRole;
  allowedDomains?: string[];
  clearanceLevel?: ClearanceLevel;
  canWrite?: boolean;
  canReadAgentMemory?: boolean;
}): Promise<{
  plainTextKey: string;
  record: Omit<typeof ekApiKeys.$inferSelect, "keyHash">;
}> {
  const secret = crypto.randomBytes(22).toString("base64url");
  const plainTextKey = `aek_${secret}`;
  const keyPrefix = `${plainTextKey.slice(0, 10)}…${plainTextKey.slice(-4)}`;
  const keyHash = crypto
    .createHash("sha256")
    .update(plainTextKey)
    .digest("hex");

  const rights = lookupRights(params.assignedRole,'api-key');
  if (!rights) throw new RosterError('Choose an active principal.');
  const {capped:restricted,principal:bound} = rights;
  const role = bound.role;
  const clearance = normalizeClearance(params.clearanceLevel || bound.clearance);
  if (restricted && (params.canWrite || params.canReadAgentMemory || CLEARANCE_RANK[clearance] > CLEARANCE_RANK[bound.clearance])) {
    throw new RosterError("Key grants exceed the selected executive's permission preset.");
  }
  const domains =
    Array.isArray(params.allowedDomains) && (restricted || params.allowedDomains.length > 0)
      ? params.allowedDomains
      : ["*"];

  const [saved] = await db
    .insert(ekApiKeys)
    .values({
      name: params.name.trim(),
      keyPrefix,
      keyHash,
      assignedRole: role,
      allowedDomains: domains,
      clearanceLevel: clearance,
      canWrite: Boolean(params.canWrite),
      canReadAgentMemory: Boolean(params.canReadAgentMemory),
    })
    .returning();

  const { keyHash: _unused, ...safeRecord } = saved;
  void _unused;
  return { plainTextKey, record: safeRecord };
}

export async function listEnterpriseApiKeys() {
  const rows = await db
    .select()
    .from(ekApiKeys)
    .orderBy(desc(ekApiKeys.id));
  return rows.map(({ keyHash: _unused, ...rest }) => {
    void _unused;
    return rest;
  });
}

export async function revokeEnterpriseApiKey(id: number): Promise<void> {
  await db
    .update(ekApiKeys)
    .set({ revoked: true })
    .where(eq(ekApiKeys.id, id));
}
