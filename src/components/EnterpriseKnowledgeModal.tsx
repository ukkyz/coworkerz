"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BookMarked,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FilePlus2,
  FileText,
  GitBranch,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Network,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Webhook,
  X,
  XCircle,
} from "lucide-react";
import {principalOptions, type Executive} from "@/lib/roster";
import MermaidMindmapView from "./MermaidMindmapView";
import KnowledgeGraphView from "./KnowledgeGraphView";
import type {
  ClearanceLevel,
  EkDocument,
  EkDomain,
  PrincipalRole,
  SkosConcept,
} from "@/db/schema";

export type KnowledgeOsTab =
  | "mindmap"
  | "graph"
  | "documents"
  | "taxonomy"
  | "retrieval"
  | "api";

type ClientDoc = Omit<EkDocument, "embedding">;

interface TaxonomyState {
  version: number;
  schemeUri: string;
  title: string;
  yamlContent: string;
  skosTurtle: string;
  concepts: SkosConcept[];
}

interface RetrievalResponse {
  plane: string;
  agentMemoryIsolated: boolean;
  principal: {
    role: PrincipalRole;
    authType: string;
    clearance: string;
    allowedDomains: string[];
    keyName: string | null;
  };
  query: string;
  skosExpansion: {
    matchedConcepts: Array<{
      conceptId: string;
      prefLabel: string;
      domainKey: string;
      confidence: number;
    }>;
    relatedCrossDomainConcepts: string[];
  };
  aclAudit: {
    authorizedDocumentsSearched: number;
    redactedDocuments: number;
    redactedGraphEntities: number;
  };
  domainsTraversed: string[];
  crossDomainEdgesUsed: number;
  answer: string | null;
  answerMode: string;
  passages: Array<{
    chunkId: number;
    documentId: number;
    documentTitle: string;
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
  }>;
  knowledgeGraph: {
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
  };
  isolatedAgentMemory?: {
    plane: string;
    permitted: boolean;
    reason?: string;
    personaVersion?: number;
    styleHint?: string;
    recentMemories?: Array<{ role: string; type: string; content: string }>;
  };
}

interface ApiKeyRow {
  id: number;
  name: string;
  keyPrefix: string;
  assignedRole: string;
  allowedDomains: string[];
  clearanceLevel: string;
  canWrite: boolean;
  canReadAgentMemory: boolean;
  requestCount: number;
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt: string;
}

const CLEARANCE_STYLES: Record<string, string> = {
  public: "bg-emerald-50 text-emerald-700 border-emerald-200",
  internal: "bg-sky-50 text-sky-700 border-sky-200",
  confidential: "bg-amber-50 text-amber-800 border-amber-200",
  board_restricted: "bg-rose-50 text-rose-700 border-rose-200",
};

const SAMPLE_QUERIES = [
  "How does our Frankfurt sovereign GPU cluster satisfy EU GDPR/DORA rules, fit the CFO's 40/60 capital tranche gates, and unlock Q3 EMEA ARR?",
  "What is the Project Kestrel $38M M&A deal structure, EBITDA impact, and 45-day zero-trust integration plan?",
  "How do we launch the Autonomous Agent Tier with outcome-based pricing without cannibalizing our $82M seat ARR?",
];

export default function EnterpriseKnowledgeModal({
  open, roster,
  initialTab = "mindmap",
  onClose,
  onStatsChanged,
}: {
  open: boolean; roster: Executive[];
  initialTab?: KnowledgeOsTab;
  onClose: () => void;
  onStatsChanged: () => void;
}) {
  const options = principalOptions(roster);
  const aclOptions = [...options, {value:'*', label:'All permitted readers (*)'}];
  const [tab, setTab] = useState<KnowledgeOsTab>(initialTab);
  const [refreshToken, setRefreshToken] = useState(0);

  // Documents & Domains State
  const [domains, setDomains] = useState<EkDomain[]>([]);
  const [docs, setDocs] = useState<ClientDoc[]>([]);
  const [docCounts, setDocCounts] = useState({
    totalAuthorized: 0,
    approved: 0,
    pendingReview: 0,
    rejected: 0,
    aclRedacted: 0,
  });
  const [docDomainFilter, setDocDomainFilter] = useState("ALL");
  const [docReviewFilter, setDocReviewFilter] = useState("ALL");
  const [docsLoading, setDocsLoading] = useState(false);

  // Ingest Form State
  const [showIngest, setShowIngest] = useState(false);
  const [ingTitle, setIngTitle] = useState("");
  const [ingContent, setIngContent] = useState("");
  const [ingDocType, setIngDocType] = useState("policy");
  const [ingDomain, setIngDomain] = useState("auto");
  const [ingClearance, setIngClearance] = useState<ClearanceLevel>("internal");
  const [ingRoles, setIngRoles] = useState<string[]>(["CEO"]);
  const [ingesting, setIngesting] = useState(false);
  const [ingestFeedback, setIngestFeedback] = useState<string | null>(null);

  // Human Review Drawer State
  const [editingDoc, setEditingDoc] = useState<ClientDoc | null>(null);
  const [editConcepts, setEditConcepts] = useState<string[]>([]);
  const [editDomain, setEditDomain] = useState("");
  const [editClearance, setEditClearance] =
    useState<ClearanceLevel>("internal");
  const [editAcl, setEditAcl] = useState<string[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);

  // Taxonomy State
  const [taxonomy, setTaxonomy] = useState<TaxonomyState | null>(null);
  const [yamlDraft, setYamlDraft] = useState("");
  const [taxViewMode, setTaxViewMode] = useState<"yaml" | "turtle">("yaml");
  const [taxSaving, setTaxSaving] = useState(false);
  const [taxMessage, setTaxMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Hybrid Retrieval & ACL Simulator State
  const [retQuery, setRetQuery] = useState(SAMPLE_QUERIES[0]);
  const [retRole, setRetRole] = useState<PrincipalRole>("CEO");
  const [retDomains, setRetDomains] = useState<string[]>([]);
  const [retIncludeGraph, setRetIncludeGraph] = useState(true);
  const [retCheckAgentPlane, setRetCheckAgentPlane] = useState(false);
  const [retLoading, setRetLoading] = useState(false);
  const [retResult, setRetResult] = useState<RetrievalResponse | null>(null);

  // REST API Keys & Tool Manifest State
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyRole, setNewKeyRole] = useState<PrincipalRole>("EXTERNAL_AGENT");
  const [newKeyClearance, setNewKeyClearance] =
    useState<ClearanceLevel>("internal");
  const [newKeyDomains, setNewKeyDomains] = useState<string[]>(["*"]);
  const [newKeyWrite, setNewKeyWrite] = useState(false);
  const [newKeyAgentMem, setNewKeyAgentMem] = useState(false);
  const keyMember = roster.find(e=>e.id===newKeyRole);
  const capped = !!keyMember && keyMember.preset !== 'legacy';
  const [keyError, setKeyError] = useState('');
  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [toolSpec, setToolSpec] = useState<Record<string, unknown> | null>(null);
  const [specTab, setSpecTab] = useState<"curl" | "openai" | "anthropic" | "openapi">(
    "curl"
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [liveTestOutput, setLiveTestOutput] = useState<string | null>(null);
  const [liveTesting, setLiveTesting] = useState(false);



  const bumpMutation = useCallback(() => {
    setRefreshToken((t) => t + 1);
    onStatsChanged();
  }, [onStatsChanged]);

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const qs = new URLSearchParams({
        domain: docDomainFilter,
        reviewStatus: docReviewFilter,
      });
      const res = await fetch(`/api/v1/enterprise/documents?${qs.toString()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setDomains(data.domains || []);
        setDocs(data.documents || []);
        if (data.counts) setDocCounts(data.counts);
      }
    } finally {
      setDocsLoading(false);
    }
  }, [docDomainFilter, docReviewFilter]);

  const loadTaxonomy = useCallback(async () => {
    const res = await fetch("/api/v1/enterprise/taxonomy", {
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      if (data.scheme) {
        setTaxonomy(data.scheme);
        setYamlDraft(data.scheme.yamlContent);
      }
    }
  }, []);

  const loadApiResources = useCallback(async () => {
    const [kRes, sRes] = await Promise.all([
      fetch("/api/v1/enterprise/api-keys", { cache: "no-store" }),
      fetch("/api/v1/enterprise/openapi", { cache: "no-store" }),
    ]);
    if (kRes.ok) {
      const kd = await kRes.json();
      setApiKeys(kd.keys || []);
    }
    if (sRes.ok) {
      setToolSpec(await sRes.json());
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {void loadDocuments(); void loadTaxonomy();}, 0);
    return () => clearTimeout(timer);
  }, [open, loadDocuments, loadTaxonomy]);

  useEffect(() => {
    if (open && tab === "api") {const timer = setTimeout(loadApiResources, 0); return () => clearTimeout(timer);}
  }, [open, tab, loadApiResources]);

  if (!open) return null;

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore
    }
  };

  const toggleRoleIn = (
    role: string,
    list: string[],
    setter: (next: string[]) => void
  ) => {
    if (role === "CEO") return; // CEO always retains access
    setter(
      list.includes(role) ? list.filter((r) => r !== role) : [...list, role]
    );
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingTitle.trim() || !ingContent.trim()) return;
    setIngesting(true);
    setIngestFeedback(null);
    try {
      const res = await fetch("/api/v1/enterprise/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ingTitle.trim(),
          content: ingContent.trim(),
          docType: ingDocType,
          domainKey: ingDomain,
          classificationLevel: ingClearance,
          aclReadRoles: ingRoles,
          extractGraph: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.document) {
        const tagNames = (data.document.taxonomyConcepts || [])
          .map((t: { conceptId: string; confidence: number }) => `${t.conceptId} (${t.confidence}%)`)
          .join(", ");
        setIngestFeedback(
          `Ingested into "${data.document.domainKey}" (${data.chunkCount} chunks, +${data.createdEntities} KG entities, +${data.createdRelationships} edges). Auto-classified as [${tagNames}] — queued for your Human Review.`
        );
        setIngTitle("");
        setIngContent("");
        setShowIngest(false);
        await loadDocuments();
        bumpMutation();
      } else {
        setIngestFeedback(data.error || "Ingestion failed.");
      }
    } finally {
      setIngesting(false);
    }
  };

  const openReviewEditor = (doc: ClientDoc) => {
    setEditingDoc(doc);
    setEditConcepts((doc.taxonomyConcepts || []).map((t) => t.conceptId));
    setEditDomain(doc.domainKey);
    setEditClearance(doc.classificationLevel as ClearanceLevel);
    setEditAcl(doc.aclReadRoles || ["CEO"]);
    setEditNotes(doc.reviewerNotes || "");
  };

  const quickReview = async (
    docId: number,
    reviewStatus: "approved" | "rejected"
  ) => {
    setReviewSaving(true);
    try {
      await fetch(`/api/v1/enterprise/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewStatus,
          reviewerNotes:
            reviewStatus === "approved"
              ? "Verified & approved by CEO."
              : "Rejected during CEO taxonomy governance review.",
        }),
      });
      await loadDocuments();
      bumpMutation();
    } finally {
      setReviewSaving(false);
    }
  };

  const submitDetailedReview = async (
    reviewStatus: "approved" | "pending_review" | "rejected"
  ) => {
    if (!editingDoc) return;
    setReviewSaving(true);
    try {
      const res = await fetch(`/api/v1/enterprise/documents/${editingDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewStatus,
          conceptIds: editConcepts,
          domainKey: editDomain,
          classificationLevel: editClearance,
          aclReadRoles: editAcl,
          reviewerNotes: editNotes,
        }),
      });
      if (res.ok) {
        setEditingDoc(null);
        await loadDocuments();
        bumpMutation();
      }
    } finally {
      setReviewSaving(false);
    }
  };

  const handleDeleteDoc = async (docId: number) => {
    await fetch(`/api/v1/enterprise/documents/${docId}`, { method: "DELETE" });
    await loadDocuments();
    bumpMutation();
  };

  const handleSaveTaxonomy = async (reclassifyAll: boolean) => {
    setTaxSaving(true);
    setTaxMessage(null);
    try {
      const res = await fetch("/api/v1/enterprise/taxonomy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yamlContent: yamlDraft, reclassifyAll }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTaxMessage({ ok: false, text: data.error || "Invalid YAML scheme." });
        return;
      }
      setTaxonomy(data.scheme);
      setTaxMessage({
        ok: true,
        text: `Saved taxonomy v${data.scheme.version} (${data.scheme.conceptCount} SKOS concepts + OWL Turtle updated)${
          data.reclassifiedCount
            ? ` · Re-classified ${data.reclassifiedCount} documents (flagged for review).`
            : "."
        }`,
      });
      if (reclassifyAll) await loadDocuments();
      bumpMutation();
    } finally {
      setTaxSaving(false);
    }
  };

  const runRetrieval = async (e?: React.FormEvent, overrideQ?: string) => {
    if (e) e.preventDefault();
    const q = (overrideQ ?? retQuery).trim();
    if (!q) return;
    if (overrideQ) setRetQuery(overrideQ);
    setRetLoading(true);
    try {
      const res = await fetch(
        `/api/v1/enterprise/retrieve?asRole=${encodeURIComponent(retRole)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q,
            domains: retDomains,
            topK: 5,
            includeGraph: retIncludeGraph,
            graphHops: 2,
            synthesizeAnswer: true,
            includeSeparateAgentMemory: retCheckAgentPlane,
          }),
        }
      );
      setRetResult(res.ok ? await res.json() : null);
    } finally {
      setRetLoading(false);
    }
  };

  const handleMintKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setKeyError('');
    const res = await fetch("/api/v1/enterprise/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newKeyName.trim(),
        assignedRole: newKeyRole,
        clearanceLevel: newKeyClearance,
        allowedDomains: newKeyDomains,
        canWrite: newKeyWrite,
        canReadAgentMemory: newKeyAgentMem,
      }),
    });
    const data = await res.json();
    if (!res.ok) setKeyError(data.error || "Could not create key.");
    if (res.ok && data.plainTextKey) {
      setMintedKey(data.plainTextKey);
      setNewKeyName("");
      await loadApiResources();
    }
  };

  const handleRevokeKey = async (id: number) => {
    await fetch(`/api/v1/enterprise/api-keys?id=${id}`, { method: "DELETE" });
    await loadApiResources();
  };

  const runLiveEndpointTest = async (
    endpoint: "retrieve" | "graph" | "classify" | "agent-memory-isolation"
  ) => {
    setLiveTesting(true);
    setLiveTestOutput(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (mintedKey) {
        headers["Authorization"] = `Bearer ${mintedKey}`;
      } else if (endpoint === "agent-memory-isolation") {
        headers["X-Simulate-Role"] = "EXTERNAL_AGENT";
      }

      let res: Response;
      if (endpoint === "retrieve") {
        res = await fetch("/api/v1/enterprise/retrieve", {
          method: "POST",
          headers,
          body: JSON.stringify({
            query:
              "How do Frankfurt sovereign GPU nodes connect to EU GDPR, CFO tranches, and Project Kestrel?",
            topK: 3,
            includeGraph: true,
          }),
        });
      } else if (endpoint === "graph") {
        res = await fetch(
          "/api/v1/enterprise/graph?domain=technology&includeBridges=true",
          { headers }
        );
      } else if (endpoint === "classify") {
        res = await fetch("/api/v1/enterprise/classify", {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: "Q4 DORA Multi-Cloud Exit & EBITDA Guardrail",
            content:
              "Establishes 72-hour Kubernetes multi-cloud exit drills under EU DORA while enforcing 75% gross margin and 10-month payback tranches.",
          }),
        });
      } else {
        res = await fetch("/api/v1/agent-memory", { headers });
      }

      const plane = res.headers.get("X-Knowledge-Plane") || "n/a";
      const json = await res.json();
      setLiveTestOutput(
        `HTTP ${res.status} · X-Knowledge-Plane: ${plane} · Auth: ${
          mintedKey ? "Bearer aek_***" : headers["X-Simulate-Role"] || "CEO Session"
        }\n\n${JSON.stringify(json, null, 2)}`
      );
      if (mintedKey) loadApiResources();
    } finally {
      setLiveTesting(false);
    }
  };

  const originUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const sampleBearer = mintedKey || "aek_YOUR_SCOPED_API_KEY";

  const curlExamples = `# 1. Cross-Domain Hybrid + Knowledge Graph Retrieval (ACL-enforced)
curl -X POST "${originUrl}/api/v1/enterprise/retrieve" \\
  -H "Authorization: Bearer ${sampleBearer}" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"How does Frankfurt sovereign AI satisfy GDPR and CFO tranche gates?","topK":4,"includeGraph":true}'

# 2. Domain-Specific Knowledge Graph Subgraph (with cross-domain bridge edges)
curl "${originUrl}/api/v1/enterprise/graph?domain=technology&includeBridges=true" \\
  -H "Authorization: Bearer ${sampleBearer}"

# 3. Auto-Classify & Ingest Document against YAML/SKOS Taxonomy (queued for CEO review)
curl -X POST "${originUrl}/api/v1/enterprise/documents" \\
  -H "Authorization: Bearer ${sampleBearer}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"EU Sovereign Key Policy","content":"All EU customer prompts use Frankfurt HSM keys under GDPR and DORA.","domainKey":"auto","classificationLevel":"internal"}'

# 4. Export Formal SKOS/OWL Taxonomy (yaml | skos-turtle | json) & Mermaid Mindmap
curl "${originUrl}/api/v1/enterprise/taxonomy?format=skos-turtle" -H "Authorization: Bearer ${sampleBearer}"
curl "${originUrl}/api/v1/enterprise/mindmap?format=mermaid" -H "Authorization: Bearer ${sampleBearer}"

# 5. Strictly Isolated Agent Memory Service (returns HTTP 403 unless canReadAgentMemory=true)
curl "${originUrl}/api/v1/agent-memory" -H "Authorization: Bearer ${sampleBearer}"`;

  const domainColor = (key: string) =>
    domains.find((d) => d.key === key)?.colorHex || "#334155";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-2.5 backdrop-blur-xs sm:p-5">
      <div className="flex h-[93vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-2xl">
        {/* Studio Header */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-xs">
              <Layers className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-slate-900">
                  CEO Enterprise AI Knowledge & Memory OS
                </h2>
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                  Domain KBs · ACLs · YAML/SKOS · GraphRAG · REST Tools
                </span>
                <span className="hidden rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200 lg:inline-block">
                  Agent Memory Isolated
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Governed institutional knowledge plane for the CEO, C-suite bots,
                and external AI models — strictly decoupled from chat memory.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            title="Return to 3D Executive Boardroom"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-5 py-2">
          {(
            [
              { id: "mindmap", label: "Mermaid Mindmap", icon: GitBranch },
              { id: "graph", label: "Knowledge Graph", icon: Network },
              {
                id: "documents",
                label: "Domain KBs & Review",
                icon: BookMarked,
                badge: docCounts.pendingReview,
              },
              {
                id: "taxonomy",
                label: "YAML / SKOS Taxonomy",
                icon: Tag,
              },
              {
                id: "retrieval",
                label: "Hybrid Retrieval & ACL",
                icon: Search,
              },
              {
                id: "api",
                label: "REST API & AI Tools",
                icon: Webhook,
              },
            ] as Array<{
              id: KnowledgeOsTab;
              label: string;
              icon: React.ComponentType<{ className?: string }>;
              badge?: number;
            }>
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
                {typeof item.badge === "number" && item.badge > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 font-mono text-[10px] font-bold ${
                      active
                        ? "bg-amber-400 text-slate-950"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* 1. MERMAID MINDMAP VISUALIZER */}
          {tab === "mindmap" && (
            <MermaidMindmapView
              roster={roster} refreshToken={refreshToken}
              onJumpTab={(next) => setTab(next)}
            />
          )}

          {/* 2. DOMAIN-TAGGED KNOWLEDGE GRAPH */}
          {tab === "graph" && <KnowledgeGraphView roster={roster} onMutated={bumpMutation} />}

          {/* 3. DOMAIN KBs, AUTO-CLASSIFICATION & HUMAN REVIEW QUEUE */}
          {tab === "documents" && (
            <div className="space-y-4">
              {/* Domain Cards & Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDocDomainFilter("ALL")}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                      docDomainFilter === "ALL"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    All Domains ({docCounts.totalAuthorized})
                  </button>
                  {domains.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setDocDomainFilter(d.key)}
                      style={
                        docDomainFilter === d.key
                          ? { backgroundColor: d.colorHex }
                          : undefined
                      }
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        docDomainFilter === d.key
                          ? "text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {d.name.split(" ")[0]} ({d.ownerRole})
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: "ALL", label: "All Status" },
                    {
                      id: "pending_review",
                      label: `Pending Review (${docCounts.pendingReview})`,
                    },
                    {
                      id: "approved",
                      label: `Approved (${docCounts.approved})`,
                    },
                    { id: "rejected", label: "Rejected" },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setDocReviewFilter(st.id)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                        docReviewFilter === st.id
                          ? "border-blue-600 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setShowIngest((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-blue-800"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    Ingest & Auto-Classify
                  </button>
                </div>
              </div>

              {ingestFeedback && (
                <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
                  <span>{ingestFeedback}</span>
                  <button
                    type="button"
                    onClick={() => setIngestFeedback(null)}
                    className="ml-2 text-emerald-700 hover:underline"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Ingest + Zero-Shot SKOS Auto-Classify Form */}
              {showIngest && (
                <form
                  onSubmit={handleIngest}
                  className="space-y-3 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Ingest Enterprise Document (Auto-Classified Against YAML/SKOS Scheme)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Automatically assigns SKOS concepts, chunks & embeds 128-d vectors, extracts domain-tagged KG entities/edges, and queues for CEO human review.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <input
                      type="text"
                      required
                      value={ingTitle}
                      onChange={(e) => setIngTitle(e.target.value)}
                      placeholder="Document title (e.g. FIN-209: Q4 Sovereign GPU Hedging & DORA Audit Policy)"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs sm:col-span-2"
                    />
                    <select
                      value={ingDomain}
                      onChange={(e) => setIngDomain(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium"
                    >
                      <option value="auto">
                        Domain: Auto-Detect via SKOS Classifier
                      </option>
                      {domains.map((d) => (
                        <option key={d.key} value={d.key}>
                          Domain: {d.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={ingDocType}
                      onChange={(e) => setIngDocType(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium"
                    >
                      <option value="policy">Type: Policy</option>
                      <option value="architecture_rfc">Type: Architecture RFC</option>
                      <option value="financial_model">Type: Financial Model</option>
                      <option value="runbook">Type: Operational Runbook</option>
                      <option value="board_memo">Type: Board Memo</option>
                      <option value="regulatory_filing">Type: Regulatory Standard</option>
                    </select>
                  </div>

                  <textarea
                    rows={4}
                    required
                    value={ingContent}
                    onChange={(e) => setIngContent(e.target.value)}
                    placeholder="Paste policy, RFC, financial model, M&A memo, or operational runbook text..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs leading-relaxed"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={ingClearance}
                        onChange={(e) =>
                          setIngClearance(e.target.value as ClearanceLevel)
                        }
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold"
                      >
                        <option value="public">Clearance: public</option>
                        <option value="internal">Clearance: internal</option>
                        <option value="confidential">Clearance: confidential</option>
                        <option value="board_restricted">
                          Clearance: board_restricted
                        </option>
                      </select>

                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        <span className="font-semibold text-slate-500">
                          ACL Read:
                        </span>
                        {aclOptions.map(({value:r,label}) => {
                          const checked = ingRoles.includes(r);
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => toggleRoleIn(r, ingRoles, setIngRoles)}
                              className={`rounded-md px-2 py-0.5 font-mono text-[10.5px] font-bold transition ${
                                checked
                                  ? "bg-slate-900 text-white"
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowIngest(false)}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={ingesting}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                      >
                        {ingesting && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        Classify, Index & Queue for Review
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Documents List */}
              {docsLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  Loading domain knowledge bases...
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {docs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs"
                    >
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="rounded-md px-2 py-0.5 text-[10px] font-bold text-white"
                              style={{
                                backgroundColor: domainColor(doc.domainKey),
                              }}
                            >
                              {doc.domainKey}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                                CLEARANCE_STYLES[doc.classificationLevel] ||
                                CLEARANCE_STYLES.internal
                              }`}
                            >
                              <Lock className="h-2.5 w-2.5" />
                              {doc.classificationLevel}
                            </span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                              {doc.docType}
                            </span>
                          </div>

                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${
                              doc.reviewStatus === "approved"
                                ? "bg-emerald-50 text-emerald-700"
                                : doc.reviewStatus === "pending_review"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {doc.reviewStatus === "approved" ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : doc.reviewStatus === "pending_review" ? (
                              <Clock className="h-3 w-3" />
                            ) : (
                              <XCircle className="h-3 w-3" />
                            )}
                            {doc.reviewStatus.replace("_", " ")}
                          </span>
                        </div>

                        <h4 className="mt-2 text-sm font-bold text-slate-900">
                          {doc.title}
                        </h4>
                        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-600">
                          {doc.summary}
                        </p>

                        {/* Auto-classified SKOS Taxonomy Concepts */}
                        <div className="mt-3">
                          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                            <span>
                              SKOS CLASSIFICATIONS ({doc.classifierMode})
                            </span>
                            <span>Doc #{doc.id}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {(doc.taxonomyConcepts || []).map((tag) => (
                              <span
                                key={tag.conceptId}
                                title={`Signals: ${tag.matchedSignals.join(", ")}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2 py-0.5 text-[10.5px] font-medium text-indigo-900"
                              >
                                <span className="font-semibold">
                                  {tag.prefLabel}
                                </span>
                                <span className="font-mono text-[9.5px] text-indigo-600">
                                  {tag.confidence}%
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* ACL Roles & Human Review Actions */}
                      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                        <div className="flex flex-wrap items-center gap-1 text-[10px]">
                          <span className="font-semibold text-slate-400">
                            ACL:
                          </span>
                          {(doc.aclReadRoles || []).map((r) => (
                            <span
                              key={r}
                              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-700"
                            >
                              {r}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {doc.reviewStatus === "pending_review" && (
                            <>
                              <button
                                type="button"
                                disabled={reviewSaving}
                                onClick={() => quickReview(doc.id, "approved")}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={reviewSaving}
                                onClick={() => quickReview(doc.id, "rejected")}
                                className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => openReviewEditor(doc)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Review Tags & ACL
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDoc(doc.id)}
                            className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            title="Delete document"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Human-in-the-Loop Classification & ACL Review Modal */}
              {editingDoc && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
                  onClick={() => setEditingDoc(null)}
                >
                  <div
                    className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold tracking-wider text-blue-600 uppercase">
                          Human-in-the-Loop Taxonomy & ACL Review
                        </span>
                        <h3 className="text-sm font-bold text-slate-900">
                          {editingDoc.title}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingDoc(null)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="max-h-36 overflow-y-auto rounded-xl bg-slate-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
                      {editingDoc.content}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-600">
                          Primary Domain
                        </label>
                        <select
                          value={editDomain}
                          onChange={(e) => setEditDomain(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                        >
                          {domains.map((d) => (
                            <option key={d.key} value={d.key}>
                              {d.name} ({d.key})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-600">
                          Clearance Level
                        </label>
                        <select
                          value={editClearance}
                          onChange={(e) =>
                            setEditClearance(e.target.value as ClearanceLevel)
                          }
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                        >
                          <option value="public">public</option>
                          <option value="internal">internal</option>
                          <option value="confidential">confidential</option>
                          <option value="board_restricted">board_restricted</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-slate-600">
                        ACL Permitted Reader Roles
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {aclOptions.map(({value:r,label}) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => toggleRoleIn(r, editAcl, setEditAcl)}
                            className={`rounded-lg px-2.5 py-1 font-mono text-xs font-bold ${
                              editAcl.includes(r)
                                ? "bg-slate-900 text-white"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[11px] font-bold text-slate-600">
                        Assigned SKOS Taxonomy Concepts (click to toggle)
                      </label>
                      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2.5">
                        {(taxonomy?.concepts || []).map((c) => {
                          const active = editConcepts.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() =>
                                setEditConcepts((prev) =>
                                  prev.includes(c.id)
                                    ? prev.filter((x) => x !== c.id)
                                    : [...prev, c.id]
                                )
                              }
                              className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                                active
                                  ? "border-indigo-600 bg-indigo-600 text-white"
                                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              {c.prefLabel}{" "}
                              <span className="opacity-70">[{c.domainKey}]</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-slate-600">
                        CEO Reviewer Notes
                      </label>
                      <input
                        type="text"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Verification note saved to audit trail..."
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                      />
                    </div>

                    <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        disabled={reviewSaving}
                        onClick={() => submitDetailedReview("rejected")}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-700"
                      >
                        Reject Document
                      </button>
                      <button
                        type="button"
                        disabled={reviewSaving}
                        onClick={() => submitDetailedReview("approved")}
                        className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Save & Approve
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4. FORMAL YAML / SKOS / OWL TAXONOMY SCHEME */}
          {tab === "taxonomy" && taxonomy && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* Left: Editable YAML / SKOS Turtle */}
              <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:col-span-7">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        knowledge/taxonomy.skos.{taxViewMode === "yaml" ? "yaml" : "ttl"}
                      </span>
                      <span className="rounded bg-indigo-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        v{taxonomy.version}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      URI: <code className="font-mono">{taxonomy.schemeUri}</code> ·{" "}
                      {taxonomy.concepts.length} SKOS concepts
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTaxViewMode("yaml")}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        taxViewMode === "yaml"
                          ? "bg-slate-900 text-white"
                          : "bg-white border border-slate-200 text-slate-600"
                      }`}
                    >
                      YAML Scheme (Editable)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaxViewMode("turtle")}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        taxViewMode === "turtle"
                          ? "bg-slate-900 text-white"
                          : "bg-white border border-slate-200 text-slate-600"
                      }`}
                    >
                      SKOS / OWL Turtle
                    </button>
                    <a
                      href={`/api/v1/enterprise/taxonomy?format=${
                        taxViewMode === "yaml" ? "yaml" : "skos-turtle"
                      }&download=1`}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3 w-3" /> Export
                    </a>
                  </div>
                </div>

                {taxViewMode === "yaml" ? (
                  <textarea
                    value={yamlDraft}
                    onChange={(e) => setYamlDraft(e.target.value)}
                    spellCheck={false}
                    className="h-[430px] w-full resize-none bg-slate-950 p-4 font-mono text-[11.5px] leading-relaxed text-slate-100 focus:outline-none"
                  />
                ) : (
                  <pre className="h-[430px] w-full overflow-auto bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-emerald-300">
                    {taxonomy.skosTurtle}
                  </pre>
                )}

                {taxMessage && (
                  <div
                    className={`border-t px-4 py-2 text-xs ${
                      taxMessage.ok
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-rose-200 bg-rose-50 text-rose-800"
                    }`}
                  >
                    {taxMessage.text}
                  </div>
                )}

                {taxViewMode === "yaml" && (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
                    <button
                      type="button"
                      disabled={taxSaving}
                      onClick={() => handleSaveTaxonomy(false)}
                      className="rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      Validate & Save YAML
                    </button>
                    <button
                      type="button"
                      disabled={taxSaving}
                      onClick={() => handleSaveTaxonomy(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                    >
                      {taxSaving && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      Save & Re-Classify All Docs
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Visual SKOS Hierarchy Browser */}
              <div className="max-h-[555px] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-5">
                <h3 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                  Parsed SKOS Concept Hierarchy & Cross-Domain Links
                </h3>
                {domains.map((d) => {
                  const list = taxonomy.concepts.filter(
                    (c) => c.domainKey === d.key
                  );
                  if (!list.length) return null;
                  return (
                    <div
                      key={d.key}
                      className="rounded-xl border border-slate-200 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="rounded-md px-2 py-0.5 text-[10px] font-bold text-white"
                          style={{ backgroundColor: d.colorHex }}
                        >
                          {d.name} ({d.key})
                        </span>
                        <span className="text-[10px] font-semibold text-slate-400">
                          {list.length} concepts
                        </span>
                      </div>
                      {list.map((c) => (
                        <div
                          key={c.id}
                          className={`rounded-lg bg-slate-50 p-2.5 text-xs ${
                            c.broader ? "ml-3 border-l-2 border-indigo-400" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-900">
                              {c.prefLabel}
                            </span>
                            <code className="font-mono text-[10px] text-indigo-700">
                              {c.id}
                            </code>
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-600">
                            {c.definition}
                          </p>
                          {c.altLabels.length > 0 && (
                            <div className="mt-1 text-[10px] text-slate-500">
                              <span className="font-semibold">altLabel:</span>{" "}
                              {c.altLabels.join(", ")}
                            </div>
                          )}
                          {c.related.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {c.related.map((r) => (
                                <span
                                  key={r}
                                  className="rounded bg-blue-100/70 px-1.5 py-0.2 font-mono text-[9.5px] text-blue-800"
                                >
                                  skos:related → {r}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 5. HYBRID RETRIEVAL (VECTOR + BM25 + SKOS + GRAPHRAG) & ACL SIMULATOR */}
          {tab === "retrieval" && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => runRetrieval(e)}
                className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs"
              >
                <div className="flex flex-wrap gap-1.5">
                  {SAMPLE_QUERIES.map((sq, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => runRetrieval(undefined, sq)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                    >
                      <Sparkles className="h-3 w-3 text-blue-600" />
                      <span className="max-w-xs truncate">{sq}</span>
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={retQuery}
                    onChange={(e) => setRetQuery(e.target.value)}
                    placeholder="Ask a single-domain or cross-domain enterprise knowledge question..."
                    className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={retLoading}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                  >
                    {retLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5" />
                    )}
                    Retrieve
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-400 uppercase">
                      Domains:
                    </span>
                    {domains.map((d) => {
                      const selected = retDomains.includes(d.key);
                      return (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() =>
                            setRetDomains((prev) =>
                              prev.includes(d.key)
                                ? prev.filter((x) => x !== d.key)
                                : [...prev, d.key]
                            )
                          }
                          className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${
                            selected
                              ? "bg-slate-900 text-white"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {d.key}
                        </button>
                      );
                    })}
                    {retDomains.length === 0 && (
                      <span className="text-[11px] text-blue-600 font-medium">
                        (All authorized domains — cross-domain enabled)
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                      <span className="text-[11px] text-slate-500">
                        Simulate Caller ACL:
                      </span>
                      <select
                        value={retRole}
                        onChange={(e) =>
                          setRetRole(e.target.value as PrincipalRole)
                        }
                        className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
                      >
                        {options.map(({value:r,label}) => (
                          <option key={r} value={r}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={retIncludeGraph}
                        onChange={(e) => setRetIncludeGraph(e.target.checked)}
                        className="accent-blue-600"
                      />
                      GraphRAG 2-Hop
                    </label>

                    <label className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={retCheckAgentPlane}
                        onChange={(e) => setRetCheckAgentPlane(e.target.checked)}
                        className="accent-indigo-600"
                      />
                      Verify Agent-Memory Isolation
                    </label>
                  </div>
                </div>
              </form>

              {retResult && (
                <div className="space-y-4">
                  {/* Synthesized Answer + ACL Audit */}
                  <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-xs space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded-md bg-blue-700 px-2 py-0.5 font-bold text-white">
                          Principal: {retResult.principal.role} (
                          {retResult.principal.clearance})
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                          Domains: {retResult.domainsTraversed.join(", ") || "none"}
                        </span>
                        <span className="rounded-md bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                          {retResult.crossDomainEdgesUsed} cross-domain KG edges
                        </span>
                      </div>

                      {retResult.aclAudit.redactedDocuments > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 border border-rose-200">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          {retResult.aclAudit.redactedDocuments} doc(s) &{" "}
                          {retResult.aclAudit.redactedGraphEntities} entity(s) redacted by ACL
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                          <ShieldCheck className="h-3.5 w-3.5" /> Full ACL clearance
                        </span>
                      )}
                    </div>

                    <p className="text-xs leading-relaxed text-slate-800">
                      {retResult.answer}
                    </p>

                    {retResult.skosExpansion.matchedConcepts.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 text-[10.5px]">
                        <span className="font-bold text-slate-400">
                          SKOS EXPANSION:
                        </span>
                        {retResult.skosExpansion.matchedConcepts.map((c) => (
                          <span
                            key={c.conceptId}
                            className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-indigo-800"
                          >
                            {c.conceptId}
                          </span>
                        ))}
                        {retResult.skosExpansion.relatedCrossDomainConcepts
                          .slice(0, 4)
                          .map((r) => (
                            <span
                              key={r}
                              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600"
                            >
                              +related:{r}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Passages & Graph Triples */}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                    <div className="space-y-2.5 lg:col-span-7">
                      <h4 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                        Ranked Enterprise KB Passages (BM25 + 128d Vector + SKOS)
                      </h4>
                      {retResult.passages.map((p) => (
                        <div
                          key={p.chunkId}
                          className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <div className="flex items-center gap-1.5 font-bold text-slate-900">
                              <FileText className="h-3.5 w-3.5 text-blue-600" />
                              <span>
                                [Doc #{p.documentId}] {p.documentTitle}
                              </span>
                            </div>
                            <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-[10px] font-bold text-blue-800">
                              score {p.scores.combined.toFixed(2)} (lex{" "}
                              {p.scores.lexical.toFixed(2)} · vec{" "}
                              {p.scores.vector.toFixed(2)} · skos +
                              {p.scores.taxonomyBoost.toFixed(2)})
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-slate-600">
                            <span className="font-semibold text-slate-800">
                              {p.heading}:{" "}
                            </span>
                            {p.content}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <span className="font-semibold text-slate-600">
                              Domain: {p.domainKey}
                            </span>
                            <span>· Clearance: {p.classificationLevel}</span>
                            <span>· Status: {p.reviewStatus}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2.5 lg:col-span-5">
                      <h4 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                        Traversed Knowledge Graph Triples
                      </h4>
                      {retResult.knowledgeGraph.triples.map((t) => (
                        <div
                          key={t.id}
                          className={`rounded-xl border p-3 text-xs ${
                            t.isCrossDomain
                              ? "border-blue-200 bg-blue-50/40"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-1 font-semibold text-slate-900">
                            <span>{t.subject}</span>
                            <ArrowRight className="h-3 w-3 text-slate-400" />
                            <code className="rounded bg-slate-900 px-1.5 py-0.2 font-mono text-[10px] text-white">
                              {t.predicate}
                            </code>
                            <ArrowRight className="h-3 w-3 text-slate-400" />
                            <span>{t.object}</span>
                          </div>
                          <div className="mt-1 text-[10.5px] text-slate-500">
                            {t.subjectDomain} → {t.objectDomain}{" "}
                            {t.isCrossDomain ? "(cross-domain bridge)" : ""}
                          </div>
                          {t.evidence && (
                            <p className="mt-1 text-[11px] text-slate-600">
                              {t.evidence}
                            </p>
                          )}
                        </div>
                      ))}

                      {retResult.isolatedAgentMemory && (
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs">
                          <div className="font-bold text-indigo-900">
                            Separate Envelope: Plane B Agent Memory
                          </div>
                          {!retResult.isolatedAgentMemory.permitted ? (
                            <p className="mt-1 text-rose-700 font-medium">
                              {retResult.isolatedAgentMemory.reason}
                            </p>
                          ) : (
                            <p className="mt-1 text-indigo-800">
                              CEO Persona v
                              {retResult.isolatedAgentMemory.personaVersion} ·{" "}
                              {retResult.isolatedAgentMemory.styleHint} (kept in
                              separate envelope — never mixed into Enterprise KB
                              passages).
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 6. EXTERNAL REST API & AI MODEL TOOLS GATEWAY */}
          {tab === "api" && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* Left: Scoped API Key Management */}
              <div className="space-y-4 lg:col-span-5">
                <form
                  onSubmit={handleMintKey}
                  className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-blue-600" />
                    <h3 className="text-xs font-bold text-slate-900">
                      Mint Scoped REST API Key for External AI Models
                    </h3>
                  </div>

                  <input
                    type="text"
                    required
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="AI client name (e.g. OpenCode Coding Agent, Finance Copilot)"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <select
                      aria-label="Key identity" value={newKeyRole}
                      onChange={ev => {
                        const next = ev.target.value as PrincipalRole;
                        setNewKeyRole(next); setKeyError('');
                        const member = roster.find(e => e.id === next);
                        if (member && member.preset !== 'legacy') {
                          setNewKeyClearance(member.preset === 'none' ? 'public' : member.preset);
                          setNewKeyWrite(false); setNewKeyAgentMem(false);
                        }
                      }}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold"
                    >
                      {options.map(({value:r,label}) => (
                        <option key={r} value={r}>
                          Role: {label}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Key clearance" value={newKeyClearance}
                      onChange={(e) =>
                        setNewKeyClearance(e.target.value as ClearanceLevel)
                      }
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold"
                    >
                      <option value="public">Clearance: public</option>
                      <option disabled={capped && keyMember.preset === 'none'} value="internal">Clearance: internal</option>
                      <option disabled={capped && keyMember.preset !== 'confidential'} value="confidential">Clearance: confidential</option>
                      <option disabled={capped} value="board_restricted">Clearance: board_restricted</option>
                    </select>
                  </div>

                  <div>
                    <div className="mb-1 text-[10.5px] font-bold text-slate-500">
                      Domain Scope
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setNewKeyDomains(["*"])}
                        className={`rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${
                          newKeyDomains.includes("*")
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        All Domains (*)
                      </button>
                      {domains.map((d) => {
                        const active = newKeyDomains.includes(d.key);
                        return (
                          <button
                            key={d.key}
                            type="button"
                            onClick={() => {
                              const base = newKeyDomains.filter((x) => x !== "*");
                              const next = active
                                ? base.filter((x) => x !== d.key)
                                : [...base, d.key];
                              setNewKeyDomains(capped || next.length ? next : ["*"]);
                            }}
                            className={`rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${
                              active
                                ? "bg-blue-700 text-white"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {d.key}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 text-xs">
                    <label className="inline-flex items-center gap-2 text-slate-700">
                      <input
                        type="checkbox"
                        disabled={capped} checked={newKeyWrite}
                        onChange={(e) => setNewKeyWrite(e.target.checked)}
                        className="accent-blue-600"
                      />
                      Allow document ingest & graph write (still enters review queue)
                    </label>
                    <label className="inline-flex items-center gap-2 text-slate-700">
                      <input
                        type="checkbox"
                        disabled={capped} checked={newKeyAgentMem}
                        onChange={(e) => setNewKeyAgentMem(e.target.checked)}
                        className="accent-indigo-600"
                      />
                      Also grant <code className="font-mono">/api/v1/agent-memory</code>{" "}
                      access (default OFF for isolation)
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-xl bg-slate-900 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Generate Bearer API Key
                  </button>

                  {keyError && <p role="alert" className="text-red-800">{keyError}</p>}
                  {mintedKey && (
                    <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs">
                      <div className="flex items-center justify-between font-bold text-emerald-900">
                        <span>Copy new API key (shown once, SHA-256 stored):</span>
                        <button
                          type="button"
                          onClick={() => copyText("minted", mintedKey)}
                          className="inline-flex items-center gap-1 text-emerald-800 underline"
                        >
                          {copiedId === "minted" ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          Copy
                        </button>
                      </div>
                      <code className="mt-1 block break-all font-mono text-[11px] text-emerald-950">
                        {mintedKey}
                      </code>
                    </div>
                  )}
                </form>

                {/* Active Keys List */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-2">
                  <div className="text-xs font-bold text-slate-900">
                    Issued External AI Client Keys ({apiKeys.length})
                  </div>
                  {apiKeys.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No external keys minted yet. Create one above to authenticate external LLMs or test ACL/plane isolation live.
                    </p>
                  ) : (
                    apiKeys.map((k) => (
                      <div
                        key={k.id}
                        className={`flex items-center justify-between rounded-xl border p-2.5 text-xs ${
                          k.revoked
                            ? "border-slate-100 bg-slate-50 opacity-55"
                            : "border-slate-200"
                        }`}
                      >
                        <div>
                          <div className="font-bold text-slate-900">
                            {k.name}{" "}
                            <code className="font-mono text-[10px] font-normal text-slate-500">
                              {k.keyPrefix}
                            </code>
                          </div>
                          <div className="text-[10.5px] text-slate-500">
                            {k.assignedRole} · {k.clearanceLevel} · domains:[
                            {k.allowedDomains.join(",")}] · {k.requestCount} calls ·
                            agentMem:{k.canReadAgentMemory ? "yes" : "blocked"}
                          </div>
                        </div>
                        {!k.revoked ? (
                          <button
                            type="button"
                            onClick={() => handleRevokeKey(k.id)}
                            className="rounded-lg border border-rose-200 px-2 py-1 text-[10.5px] font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            Revoke
                          </button>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400">
                            REVOKED
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right: REST Tool Schemas & Live Endpoint Runner */}
              <div className="space-y-4 lg:col-span-7">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          { id: "curl", label: "REST cURL Examples" },
                          { id: "openai", label: "OpenAI / OpenCode Tools" },
                          { id: "anthropic", label: "Anthropic Tools" },
                          { id: "openapi", label: "OpenAPI 3.1 Spec" },
                        ] as const
                      ).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSpecTab(s.id)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                            specTab === s.id
                              ? "bg-slate-900 text-white"
                              : "bg-white border border-slate-200 text-slate-600"
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const txt =
                          specTab === "curl"
                            ? curlExamples
                            : specTab === "openai"
                            ? JSON.stringify(
                                (toolSpec?.toolSchemas as Record<string, unknown>)
                                  ?.openaiAndOpencode || [],
                                null,
                                2
                              )
                            : specTab === "anthropic"
                            ? JSON.stringify(
                                (toolSpec?.toolSchemas as Record<string, unknown>)
                                  ?.anthropic || [],
                                null,
                                2
                              )
                            : JSON.stringify(toolSpec?.openapi || {}, null, 2);
                        copyText("spec", txt);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                    >
                      {copiedId === "spec" ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      Copy
                    </button>
                  </div>

                  <pre className="max-h-72 overflow-auto bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-emerald-300">
                    {specTab === "curl"
                      ? curlExamples
                      : specTab === "openai"
                      ? JSON.stringify(
                          (toolSpec?.toolSchemas as Record<string, unknown>)
                            ?.openaiAndOpencode || [],
                          null,
                          2
                        )
                      : specTab === "anthropic"
                      ? JSON.stringify(
                          (toolSpec?.toolSchemas as Record<string, unknown>)
                            ?.anthropic || [],
                          null,
                          2
                        )
                      : JSON.stringify(toolSpec?.openapi || {}, null, 2)}
                  </pre>
                </div>

                {/* Live REST Tool Runner */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">
                      Live REST Tool Playground{" "}
                      {mintedKey
                        ? "(Using your newly minted Bearer key)"
                        : "(Click to invoke live /api/v1/* endpoints)"}
                    </span>
                    {liveTesting && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => runLiveEndpointTest("retrieve")}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-800"
                    >
                      <Play className="h-3 w-3" /> POST /v1/enterprise/retrieve
                    </button>
                    <button
                      type="button"
                      onClick={() => runLiveEndpointTest("graph")}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      <Play className="h-3 w-3" /> GET /v1/enterprise/graph
                    </button>
                    <button
                      type="button"
                      onClick={() => runLiveEndpointTest("classify")}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      <Play className="h-3 w-3" /> POST /v1/enterprise/classify
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runLiveEndpointTest("agent-memory-isolation")
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-800 hover:bg-rose-100"
                    >
                      <Lock className="h-3 w-3" /> Test /v1/agent-memory Isolation
                    </button>
                  </div>

                  {liveTestOutput && (
                    <pre className="max-h-60 overflow-auto rounded-xl bg-slate-950 p-3.5 font-mono text-[10.5px] leading-relaxed text-sky-200">
                      {liveTestOutput}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
