"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  FolderOpen,
  History,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import {accentOf, type Executive} from '@/lib/roster';
import type { CeoPersonaProfile } from "@/db/schema";

interface MemoryPayload {
  persona: {
    version: number;
    markdown: string;
    profile: CeoPersonaProfile | null;
    providerMode: string;
    updatedAt: string;
  } | null;
  revisions: Array<{
    id: number;
    version: number;
    changeSummary: string;
    triggerEvent: string;
    sessionId: number | null;
    createdAt: string;
  }>;
  stats: {
    totalMessages: number;
    ceoMessages: number;
    botToBot: number;
    botToCeo: number;
    totalMemories: number;
    memoriesByRole: Record<string, number>;
  };
  files: Array<{ path: string; size: number; updatedAt: string }>;
  memoryDir: string;
}



function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function MemoryPanel({ refreshKey, roster }: { refreshKey: number; roster: Executive[] }) {
  const [data, setData] = useState<MemoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [viewer, setViewer] = useState<{ path: string; content: string } | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Background memory sync runs right after each message; refetch shortly after & once more for AI refinement
    const t1 = setTimeout(load, refreshKey === 0 ? 0 : 1600);
    const t2 = refreshKey === 0 ? null : setTimeout(load, 6500);
    return () => {
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [refreshKey, load]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rebuild" }),
      });
      if (res.ok) setData(await res.json());
    } finally {
      setRebuilding(false);
    }
  };

  const openFile = async (path: string) => {
    setViewerLoading(true);
    setViewer({ path, content: "" });
    try {
      const res = await fetch(`/api/memory/file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      setViewer({ path, content: res.ok ? await res.text() : "Unable to load memory file." });
    } finally {
      setViewerLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
        Loading CEO persona memory…
      </div>
    );
  }

  const p = data?.persona?.profile;

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
      <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-3 py-2 text-[10.5px] leading-snug text-indigo-900">
        <span className="font-bold">Plane B · Conversational Agent Memory</span>{" "}
        — strictly separated from your governed Enterprise Knowledge OS (
        <code className="font-mono">ek_*</code> /{" "}
        <code className="font-mono">/api/v1/enterprise/*</code>).
      </div>

      {/* Persona header */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <UserRound className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-bold text-slate-900">CEO_PERSONA.md</h3>
                <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                  v{data?.persona?.version ?? 0}
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                {data?.persona ? `Updated ${timeAgo(data.persona.updatedAt)}` : "Not generated yet"} ·{" "}
                {data?.persona?.providerMode === "opencode-live" ? "AI-refined via OpenCode" : "Embedded persona analyzer"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={rebuild}
            disabled={rebuilding}
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            title="Re-analyze every stored conversation and rewrite all memory files"
          >
            <RefreshCw className={`h-3 w-3 ${rebuilding ? "animate-spin" : ""}`} />
            Rebuild
          </button>
        </div>

        <p className="mt-2.5 text-xs leading-relaxed text-slate-700">
          {p?.executiveSummary || "Ask your C-suite a question to start building your persona."}
        </p>

        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            onClick={() => openFile("CEO_PERSONA.md")}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-900 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
          >
            <Eye className="h-3 w-3" /> View main file
          </button>
          <a
            href="/api/memory/file?path=CEO_PERSONA.md&download=1"
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3 w-3" /> Download .md
          </a>
        </div>
      </div>

      {/* Skills */}
      {p && p.skills.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <div className="mb-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase">Core Skills</div>
          <div className="space-y-2">
            {p.skills.map((s) => (
              <div key={s.name} title={s.lastEvidence}>
                <div className="mb-0.5 flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-800">{s.name}</span>
                  <span className="font-mono text-slate-500">
                    {s.score} · {s.evidenceCount} signals
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-600 transition-all duration-700"
                    style={{ width: `${s.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decision & communication style */}
      {p && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <div className="mb-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">Leadership & Decision Style</div>
          <ul className="space-y-1">
            {p.decisionStyle.map((d, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-slate-700">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-indigo-500" />
                {d}
              </li>
            ))}
          </ul>
          <div className="mt-2.5 rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-600">
            <span className="font-semibold text-slate-800">{p.communicationStyle.label}</span> · avg{" "}
            {p.communicationStyle.avgWords} words · {Math.round(p.communicationStyle.quantitativeRatio * 100)}% quantified
            <div className="mt-1 text-slate-500">C-suite adapts to: {p.styleHint}</div>
          </div>
          {p.recurringThemes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {p.recurringThemes.map((t) => (
                <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] text-indigo-700">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* What each executive remembers */}
      {p && (
        <div className="space-y-2">
          <div className="px-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">What your C-suite has learned about you</div>
          {roster.map(({id:r, ...e}) => (
            <div key={r} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: accentOf(r) }}>
                    {e.roleName}{e.retiredAfter === null ? "" : " (archived)"}
                  </span>
                  <span className="text-[11px] font-semibold wrap-anywhere text-slate-800">{e.displayName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => openFile(`executives/${r}.md`)}
                  className="font-mono text-[10px] text-slate-400 hover:text-slate-700"
                >
                  {data?.stats.memoriesByRole[r] ?? 0} memories ↗
                </button>
              </div>
              <ul className="space-y-0.5">
                {(p.executiveObservations[r] || []).slice(0, 3).map((o, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-slate-600">• {o}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Conversation memory stats */}
      {data && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Messages stored", value: data.stats.totalMessages },
            { label: "CEO messages", value: data.stats.ceoMessages },
            { label: "Bot ↔ bot exchanges", value: data.stats.botToBot },
            { label: "Executive memories", value: data.stats.totalMemories },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-2.5">
              <div className="flex items-center gap-1 text-[10px] font-medium text-slate-500">
                <MessagesSquare className="h-3 w-3" /> {s.label}
              </div>
              <div className="font-mono text-base font-bold text-slate-900">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Markdown files */}
      {data && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
            <FolderOpen className="h-3 w-3" /> Markdown memory files · {data.memoryDir}
          </div>
          {data.files.length === 0 && <div className="text-[11px] text-slate-400">Files are written after the next message or a rebuild.</div>}
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {data.files.map((f) => (
              <div key={f.path} className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50">
                <button type="button" onClick={() => openFile(f.path)} className="flex min-w-0 items-center gap-1.5 text-left">
                  <FileText className={`h-3.5 w-3.5 shrink-0 ${f.path === "CEO_PERSONA.md" ? "text-indigo-600" : "text-slate-400"}`} />
                  <span className="truncate font-mono text-[11px] text-slate-700">{f.path}</span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-slate-400">{(f.size / 1024).toFixed(1)} KB</span>
                  <a href={`/api/memory/file?path=${encodeURIComponent(f.path)}&download=1`} className="text-slate-400 hover:text-slate-700" title="Download">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revision history */}
      {data && data.revisions.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
            <History className="h-3 w-3" /> Persona revision history
          </div>
          <div className="space-y-1.5">
            {data.revisions.map((r) => (
              <div key={r.id} className="flex gap-2 text-[11px]">
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700">v{r.version}</span>
                <div className="min-w-0">
                  <div className="text-slate-700">{r.changeSummary}</div>
                  <div className="text-[10px] text-slate-400">
                    {timeAgo(r.createdAt)}
                    {r.sessionId ? ` · Session #${r.sessionId}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw markdown viewer */}
      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={() => setViewer(null)}>
          <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2 font-mono text-xs font-semibold text-slate-800">
                <FileText className="h-4 w-4 text-indigo-600" /> memory/{viewer.path}
              </div>
              <div className="flex items-center gap-1.5">
                <a
                  href={`/api/memory/file?path=${encodeURIComponent(viewer.path)}&download=1`}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3 w-3" /> Download
                </a>
                <button type="button" onClick={() => setViewer(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-50 p-4">
              {viewerLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-slate-800">{viewer.content}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
