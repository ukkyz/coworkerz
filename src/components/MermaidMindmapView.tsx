"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  Download,
  GitBranch,
  Loader2,
  Maximize2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {principalOptions, type Executive} from "@/lib/roster";
import type { PrincipalRole } from "@/db/schema";

interface MindmapSummary {
  principalRole: PrincipalRole;
  clearance: string;
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
}

const DOMAIN_OPTIONS = [
  { key: "ALL", label: "All Domains" },
  { key: "technology", label: "Technology" },
  { key: "finance", label: "Finance" },
  { key: "operations", label: "Operations" },
  { key: "governance", label: "Governance" },
  { key: "corporate_strategy", label: "Strategy & M&A" },
];

let mermaidConfigured = false;

export default function MermaidMindmapView({
  roster, refreshToken,
  onJumpTab,
}: {
  roster: Executive[]; refreshToken: number;
  onJumpTab: (tab: "graph" | "documents" | "taxonomy" | "retrieval" | "api") => void;
}) {
  const [domain, setDomain] = useState("ALL");
  const [asRole, setAsRole] = useState<PrincipalRole>("CEO");
  const [includeCrossDomain, setIncludeCrossDomain] = useState(true);
  const [mermaidCode, setMermaidCode] = useState("");
  const [summary, setSummary] = useState<MindmapSummary | null>(null);
  const [svgMarkup, setSvgMarkup] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const renderCounterRef = useRef(0);

  const fetchMindmap = useCallback(async () => {
    setLoading(true);
    setRenderError(null);
    try {
      const qs = new URLSearchParams({
        domain,
        asRole,
        includeCrossDomain: String(includeCrossDomain),
      });
      const res = await fetch(`/api/v1/enterprise/mindmap?${qs.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setRenderError(data.error || "Failed to load mindmap.");
        return;
      }
      setMermaidCode(data.mermaidCode || "");
      setSummary(data.summary || null);
    } catch {
      setRenderError("Network error while loading enterprise mindmap.");
    } finally {
      setLoading(false);
    }
  }, [domain, asRole, includeCrossDomain]);

  useEffect(() => {
    const timer = setTimeout(fetchMindmap, 0); return () => clearTimeout(timer);
  }, [fetchMindmap, refreshToken]);

  useEffect(() => {
    if (!mermaidCode) return;
    let cancelled = false;

    (async () => {
      try {
        const mermaidMod = await import("mermaid");
        const mermaid = mermaidMod.default;
        if (!mermaidConfigured) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            fontFamily: "Inter, system-ui, -apple-system, sans-serif",
            themeVariables: {
              primaryColor: "#DBEAFE",
              primaryTextColor: "#0F172A",
              primaryBorderColor: "#2563EB",
              secondaryColor: "#CCFBF1",
              secondaryTextColor: "#0F172A",
              secondaryBorderColor: "#0D9488",
              tertiaryColor: "#FEF3C7",
              tertiaryTextColor: "#0F172A",
              tertiaryBorderColor: "#D97706",
              lineColor: "#64748B",
              fontSize: "13px",
            },
          });
          mermaidConfigured = true;
        }
        renderCounterRef.current += 1;
        const graphId = `ekmm_${baseId}_${renderCounterRef.current}`;
        const { svg } = await mermaid.render(graphId, mermaidCode);
        if (!cancelled) {
          setSvgMarkup(svg);
          setRenderError(null);
        }
      } catch (err) {
        console.error("Mermaid mindmap render error:", err);
        if (!cancelled) {
          setRenderError(
            "Mermaid SVG renderer encountered a syntax issue — inspect raw diagram below."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mermaidCode, baseId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mermaidCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownload = (kind: "svg" | "mmd") => {
    const content = kind === "svg" ? svgMarkup : mermaidCode;
    if (!content) return;
    const blob = new Blob([content], {
      type: kind === "svg" ? "image/svg+xml" : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aether-enterprise-mindmap-${domain.toLowerCase()}-${asRole.toLowerCase()}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
            Domain Scope:
          </span>
          {DOMAIN_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setDomain(opt.key)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                domain === opt.key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-[11px] font-semibold text-slate-500">
              ACL View:
            </span>
            <select
              value={asRole}
              onChange={(e) => setAsRole(e.target.value as PrincipalRole)}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
            >
              {principalOptions(roster).map(({value:r,label}) => (
                <option key={r} value={r}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={includeCrossDomain}
              onChange={(e) => setIncludeCrossDomain(e.target.checked)}
              className="accent-blue-600"
            />
            Cross-Domain Bridges
          </label>

          <button
            type="button"
            onClick={fetchMindmap}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary KPI Strip */}
      {summary && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <button
            type="button"
            onClick={() => onJumpTab("documents")}
            className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300"
          >
            <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
              Domain KBs
            </div>
            <div className="mt-0.5 font-mono text-lg font-bold text-slate-900">
              {summary.domainsCount}
            </div>
            <div className="text-[11px] text-slate-500">
              {summary.approvedDocsCount} approved docs
            </div>
          </button>

          <button
            type="button"
            onClick={() => onJumpTab("documents")}
            className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-left transition hover:border-amber-400"
          >
            <div className="text-[10px] font-bold tracking-wider text-amber-700 uppercase">
              Human Review
            </div>
            <div className="mt-0.5 font-mono text-lg font-bold text-amber-900">
              {summary.pendingDocsCount}
            </div>
            <div className="text-[11px] text-amber-700">
              queued for CEO sign-off
            </div>
          </button>

          <button
            type="button"
            onClick={() => onJumpTab("taxonomy")}
            className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300"
          >
            <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
              SKOS Concepts
            </div>
            <div className="mt-0.5 font-mono text-lg font-bold text-slate-900">
              {summary.conceptsCount}
            </div>
            <div className="text-[11px] text-slate-500">YAML + OWL Turtle</div>
          </button>

          <button
            type="button"
            onClick={() => onJumpTab("graph")}
            className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300"
          >
            <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
              KG Entities
            </div>
            <div className="mt-0.5 font-mono text-lg font-bold text-slate-900">
              {summary.entitiesCount}
            </div>
            <div className="text-[11px] text-slate-500">
              {summary.relationshipsCount} total edges
            </div>
          </button>

          <button
            type="button"
            onClick={() => onJumpTab("graph")}
            className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-left transition hover:border-blue-400"
          >
            <div className="text-[10px] font-bold tracking-wider text-blue-700 uppercase">
              Cross-Domain
            </div>
            <div className="mt-0.5 font-mono text-lg font-bold text-blue-900">
              {summary.crossDomainEdgesCount}
            </div>
            <div className="text-[11px] text-blue-700">bridge relationships</div>
          </button>

          <button
            type="button"
            onClick={() => onJumpTab("retrieval")}
            className={`rounded-xl border p-3 text-left transition ${
              summary.redactedDocsCount > 0 || summary.redactedEntitiesCount > 0
                ? "border-rose-200 bg-rose-50/60 hover:border-rose-400"
                : "border-emerald-200 bg-emerald-50/50 hover:border-emerald-400"
            }`}
          >
            <div className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-slate-600 uppercase">
              {summary.redactedDocsCount > 0 ? (
                <ShieldAlert className="h-3 w-3 text-rose-600" />
              ) : (
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
              )}
              ACL Redacted
            </div>
            <div className="mt-0.5 font-mono text-lg font-bold text-slate-900">
              {summary.redactedDocsCount}d / {summary.redactedEntitiesCount}e
            </div>
            <div className="text-[11px] text-slate-600">
              for {summary.principalRole} ({summary.clearance})
            </div>
          </button>
        </div>
      )}

      {/* Rendered Mermaid Mindmap Diagram Canvas */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-blue-600" />
            <span className="text-xs font-bold text-slate-900">
              Live Mermaid Mindmap — Enterprise AI Knowledge Summary
            </span>
            <span className="rounded-md bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-800">
              mermaid mindmap
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.55, +(z - 0.15).toFixed(2)))}
                className="p-1.5 text-slate-600 hover:bg-slate-50"
                title="Zoom Out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="px-1.5 font-mono text-[11px] text-slate-600">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2)))}
                className="p-1.5 text-slate-600 hover:bg-slate-50"
                title="Zoom In"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="border-l border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                title="Reset Zoom"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowSource((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                showSource
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              {showSource ? "Hide Syntax" : "Mermaid Code"}
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy .mmd"}
            </button>

            <button
              type="button"
              onClick={() => handleDownload("svg")}
              disabled={!svgMarkup}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              SVG
            </button>
          </div>
        </div>

        <div className="relative min-h-[390px] max-h-[520px] overflow-auto bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:18px_18px] p-5">
          {loading && !svgMarkup ? (
            <div className="flex h-80 items-center justify-center gap-2 text-xs font-medium text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Rendering Enterprise Knowledge Mermaid Mindmap...
            </div>
          ) : renderError ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <div className="font-bold">{renderError}</div>
              <pre className="mt-2 overflow-auto rounded-lg bg-white p-3 font-mono text-[11px] text-slate-800">
                {mermaidCode}
              </pre>
            </div>
          ) : (
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center top",
              }}
              className="flex justify-center transition-transform duration-150 [&_svg]:h-auto [&_svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          )}
        </div>

        {showSource && (
          <div className="border-t border-slate-200 bg-slate-950 p-4">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-mono">
                GET /api/v1/enterprise/mindmap?format=mermaid&domain={domain}&asRole={asRole}
              </span>
              <button
                type="button"
                onClick={() => handleDownload("mmd")}
                className="text-blue-400 hover:underline"
              >
                Download .mmd
              </button>
            </div>
            <pre className="max-h-56 overflow-auto font-mono text-[11.5px] leading-relaxed text-emerald-300">
              {mermaidCode}
            </pre>
          </div>
        )}
      </div>

      {/* Explicit Plane Isolation Architecture Comparison */}
      {summary && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/70 to-white p-4">
            <div className="flex items-center justify-between">
              <span className="rounded-md bg-blue-700 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
                Plane A · Enterprise Knowledge Layer
              </span>
              <span className="font-mono text-[10px] text-blue-700">
                Tables: ek_* · /api/v1/enterprise/*
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-700">
              Curated, domain-organized enterprise documents, passage vectors +
              BM25 index, formal YAML/SKOS taxonomy with human-in-the-loop
              approval, role/clearance ACLs, and domain-tagged Knowledge Graph.
              Raw chats never auto-write here.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2 font-mono text-[11px] font-semibold text-slate-800">
              <span className="rounded-lg bg-white px-2.5 py-1 border border-blue-100">
                {summary.agentMemorySeparation.enterpriseDocs} KB Docs
              </span>
              <span className="rounded-lg bg-white px-2.5 py-1 border border-blue-100">
                {summary.agentMemorySeparation.enterpriseEntities} KG Entities
              </span>
              <span className="rounded-lg bg-white px-2.5 py-1 border border-blue-100">
                {summary.agentMemorySeparation.enterpriseEdges} KG Edges
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-white p-4">
            <div className="flex items-center justify-between">
              <span className="rounded-md bg-indigo-700 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
                Plane B · Conversational Agent Memory (Isolated)
              </span>
              <span className="font-mono text-[10px] text-indigo-700">
                memory/* · /api/v1/agent-memory
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-700">
              Separate episodic memory service storing executive Walk &
              Talk transcripts, personal agent journals, session notes, and your
              living <code className="font-mono">CEO_PERSONA.md</code>. Blocked
              by default (<code className="font-mono">HTTP 403</code>) for
              Enterprise KB API tokens unless explicitly granted.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2 font-mono text-[11px] font-semibold text-slate-800">
              <span className="rounded-lg bg-white px-2.5 py-1 border border-indigo-100">
                {summary.agentMemorySeparation.conversationalMessages} Chat Turns
              </span>
              <span className="rounded-lg bg-white px-2.5 py-1 border border-indigo-100">
                {summary.agentMemorySeparation.agentMemories} Bot Memories
              </span>
              <span className="rounded-lg bg-white px-2.5 py-1 border border-indigo-100">
                CEO_PERSONA v{summary.agentMemorySeparation.personaVersion}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
