"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Loader2,
  Network,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {principalOptions, type Executive} from "@/lib/roster";
import type {
  ClearanceLevel,
  EkDomain,
  EkEntity,
  PrincipalRole,
} from "@/db/schema";

interface GraphEdge {
  id: number;
  sourceEntityId: number;
  targetEntityId: number;
  predicate: string;
  domainKey: string;
  isCrossDomain: boolean;
  weight: number;
  evidence: string;
  classificationLevel: string;
  aclReadRoles: string[];
  sourceName: string;
  sourceDomain: string;
  targetName: string;
  targetDomain: string;
}

interface GraphPayload {
  domains: EkDomain[];
  entities: EkEntity[];
  relationships: GraphEdge[];
  stats: {
    visibleEntities: number;
    visibleRelationships: number;
    crossDomainRelationships: number;
    aclRedactedEntities: number;
    aclRedactedRelationships: number;
    entitiesPerDomain: Record<string, number>;
  };
}

const DOMAIN_CENTERS: Record<string, { cx: number; cy: number; rx: number }> = {
  technology: { cx: 210, cy: 155, rx: 92 },
  finance: { cx: 750, cy: 155, rx: 92 },
  governance: { cx: 480, cy: 115, rx: 82 },
  operations: { cx: 245, cy: 405, rx: 90 },
  corporate_strategy: { cx: 715, cy: 405, rx: 92 },
};

const PREDICATES = [
  "FUNDED_BY",
  "GATED_BY_METRIC",
  "SATISFIES_REGULATION",
  "OPERATED_BY",
  "UNLOCKS_REVENUE",
  "INTEGRATES_WITH",
  "MITIGATES_RISK",
  "DEPENDS_ON",
  "GOVERNED_BY_POLICY",
  "TARGETS_ACQUISITION",
];

const ENTITY_TYPES = [
  "System",
  "Initiative",
  "Metric",
  "Regulation",
  "Team",
  "FinancialInstrument",
  "Product",
  "Organization",
];

export default function KnowledgeGraphView({
  roster, onMutated,
}: {
  roster: Executive[];
  onMutated: () => void;
}) {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState("ALL");
  const [includeBridges, setIncludeBridges] = useState(true);
  const [onlyCrossDomain, setOnlyCrossDomain] = useState(false);
  const [asRole, setAsRole] = useState<PrincipalRole>("CEO");
  const [seedInput, setSeedInput] = useState("");
  const [activeSeed, setActiveSeed] = useState("");
  const [hops, setHops] = useState(2);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Add entity / relationship drawer
  const [addMode, setAddMode] = useState<"none" | "entity" | "edge">("none");
  const [entName, setEntName] = useState("");
  const [entType, setEntType] = useState("Initiative");
  const [entDomain, setEntDomain] = useState("technology");
  const [entDesc, setEntDesc] = useState("");
  const [entClearance, setEntClearance] = useState<ClearanceLevel>("internal");
  const [entRoles, setEntRoles] = useState<string[]>(["CEO"]);

  const [edgeSrc, setEdgeSrc] = useState<number>(0);
  const [edgeTgt, setEdgeTgt] = useState<number>(0);
  const [edgePred, setEdgePred] = useState("INTEGRATES_WITH");
  const [edgeDomain, setEdgeDomain] = useState("technology");
  const [edgeEvidence, setEdgeEvidence] = useState("");
  const [saving, setSaving] = useState(false);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        domain,
        includeBridges: String(includeBridges),
        onlyCrossDomain: String(onlyCrossDomain),
        asRole,
        hops: String(hops),
      });
      if (activeSeed.trim()) qs.set("seed", activeSeed.trim());
      const res = await fetch(`/api/v1/enterprise/graph?${qs.toString()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const payload = (await res.json()) as GraphPayload;
        setData(payload);
        if (payload.entities.length >= 2 && edgeSrc === 0) {
          setEdgeSrc(payload.entities[0].id);
          setEdgeTgt(payload.entities[1].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [domain, includeBridges, onlyCrossDomain, asRole, activeSeed, hops, edgeSrc]);

  useEffect(() => {
    const timer = setTimeout(loadGraph, 0); return () => clearTimeout(timer);
  }, [loadGraph]);

  const domainMap = useMemo(() => {
    const m = new Map<string, EkDomain>();
    for (const d of data?.domains || []) m.set(d.key, d);
    return m;
  }, [data]);

  // Compute deterministic, legible coordinates clustered by domain (or centered if single domain)
  const positions = useMemo(() => {
    const map = new Map<number, { x: number; y: number }>();
    if (!data) return map;

    if (domain !== "ALL" && !includeBridges) {
      const n = data.entities.length;
      data.entities.forEach((e, idx) => {
        const angle = (idx / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
        map.set(e.id, {
          x: 480 + Math.cos(angle) * 200,
          y: 270 + Math.sin(angle) * 155,
        });
      });
      return map;
    }

    const grouped = new Map<string, EkEntity[]>();
    for (const e of data.entities) {
      grouped.set(e.domainKey, [...(grouped.get(e.domainKey) || []), e]);
    }

    for (const [dKey, list] of grouped.entries()) {
      const hub = DOMAIN_CENTERS[dKey] || { cx: 480, cy: 275, rx: 85 };
      const count = list.length;
      list.forEach((ent, idx) => {
        if (count === 1) {
          map.set(ent.id, { x: hub.cx, y: hub.cy });
        } else {
          const angle =
            (idx / count) * Math.PI * 2 - Math.PI / 2 + (dKey.length % 3) * 0.25;
          const r = count <= 2 ? 56 : hub.rx;
          map.set(ent.id, {
            x: Math.max(75, Math.min(885, hub.cx + Math.cos(angle) * r)),
            y: Math.max(60, Math.min(490, hub.cy + Math.sin(angle) * (r * 0.72))),
          });
        }
      });
    }
    return map;
  }, [data, domain, includeBridges]);

  const selectedEntity = useMemo(
    () => data?.entities.find((e) => e.id === selectedId) || null,
    [data, selectedId]
  );

  const selectedEdges = useMemo(() => {
    if (!selectedEntity || !data) return [];
    return data.relationships.filter(
      (r) =>
        r.sourceEntityId === selectedEntity.id ||
        r.targetEntityId === selectedEntity.id
    );
  }, [data, selectedEntity]);

  const handleCreateEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/enterprise/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "entity",
          name: entName.trim(),
          entityType: entType,
          domainKey: entDomain,
          description: entDesc.trim() || entName.trim(),
          classificationLevel: entClearance,
          aclReadRoles: entRoles,
        }),
      });
      if (res.ok) {
        setEntName("");
        setEntDesc("");
        setAddMode("none");
        await loadGraph();
        onMutated();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateEdge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edgeSrc || !edgeTgt || edgeSrc === edgeTgt) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/enterprise/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "relationship",
          sourceEntityId: edgeSrc,
          targetEntityId: edgeTgt,
          predicate: edgePred,
          domainKey: edgeDomain,
          evidence: edgeEvidence.trim(), aclReadRoles: entRoles,
        }),
      });
      if (res.ok) {
        setEdgeEvidence("");
        setAddMode("none");
        await loadGraph();
        onMutated();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Subgraph & Cross-Domain Filter Bar */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setDomain("ALL");
                setOnlyCrossDomain(false);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                domain === "ALL" && !onlyCrossDomain
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Full Enterprise Graph
            </button>

            {(data?.domains || []).map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => {
                  setDomain(d.key);
                  setOnlyCrossDomain(false);
                }}
                style={
                  domain === d.key ? { backgroundColor: d.colorHex } : undefined
                }
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  domain === d.key
                    ? "text-white shadow-2xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: domain === d.key ? "#fff" : d.colorHex,
                  }}
                />
                {d.name.split(" ")[0]} ({data?.stats.entitiesPerDomain[d.key] ?? 0})
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                setDomain("ALL");
                setOnlyCrossDomain((v) => !v);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                onlyCrossDomain
                  ? "bg-blue-700 text-white"
                  : "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              Cross-Domain Only
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAddMode(addMode === "entity" ? "none" : "entity")}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Entity
            </button>
            <button
              type="button"
              onClick={() => setAddMode(addMode === "edge" ? "none" : "edge")}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Relationship
            </button>
          </div>
        </div>

        {/* Multi-Hop Traversal + Bridge Toggle + ACL Role */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setActiveSeed(seedInput);
            }}
            className="flex flex-1 min-w-[260px] items-center gap-1.5"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="Multi-hop cross-domain BFS (e.g. Frankfurt, GDPR, Kestrel, Margin)..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>
            <select
              value={hops}
              onChange={(e) => setHops(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value={1}>1-hop</option>
              <option value={2}>2-hop</option>
              <option value={3}>3-hop</option>
            </select>
            <button
              type="submit"
              className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
            >
              Traverse
            </button>
            {activeSeed && (
              <button
                type="button"
                onClick={() => {
                  setSeedInput("");
                  setActiveSeed("");
                }}
                className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
              >
                Clear
              </button>
            )}
          </form>

          <div className="flex flex-wrap items-center gap-2">
            {domain !== "ALL" && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={includeBridges}
                  onChange={(e) => setIncludeBridges(e.target.checked)}
                  className="accent-blue-600"
                />
                Include Cross-Domain Bridges
              </label>
            )}

            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
              <span className="text-[11px] font-semibold text-slate-500">ACL:</span>
              <select
                value={asRole}
                onChange={(e) => setAsRole(e.target.value as PrincipalRole)}
                className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
              >
                {principalOptions(roster).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Add Entity Form */}
        {addMode === "entity" && (
          <form
            onSubmit={handleCreateEntity}
            className="grid grid-cols-1 gap-2.5 rounded-xl border border-blue-200 bg-blue-50/40 p-3 sm:grid-cols-4"
          >
            <input
              type="text"
              required
              value={entName}
              onChange={(e) => setEntName(e.target.value)}
              placeholder="Entity name (e.g. Zurich Sovereign Vault)"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:col-span-2"
            />
            <select
              value={entDomain}
              onChange={(e) => setEntDomain(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
            >
              {(data?.domains || []).map((d) => (
                <option key={d.key} value={d.key}>
                  Domain: {d.name}
                </option>
              ))}
            </select>
            <select
              value={entType}
              onChange={(e) => setEntType(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  Type: {t}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={entDesc}
              onChange={(e) => setEntDesc(e.target.value)}
              placeholder="Description..."
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:col-span-2"
            />
            <select
              value={entClearance}
              onChange={(e) => setEntClearance(e.target.value as ClearanceLevel)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="public">Clearance: public</option>
              <option value="internal">Clearance: internal</option>
              <option value="confidential">Clearance: confidential</option>
              <option value="board_restricted">Clearance: board_restricted</option>
            </select>
            <label className="block text-xs font-semibold">Additional permitted readers<select multiple aria-label="Graph record readers" value={entRoles.filter(r=>r!=='CEO')} onChange={e=>setEntRoles(['CEO',...Array.from(e.target.selectedOptions, o=>o.value)])} className="block w-full rounded border bg-white p-2">
              {[...principalOptions(roster).filter(o=>o.value!=='CEO'), {value:'*',label:'All permitted readers (*)'}].map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select></label>
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEntRoles(['CEO']);
                  setAddMode("none");
                }}
                className="rounded-lg px-2.5 py-1.5 text-xs text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                Save Entity
              </button>
            </div>
          </form>
        )}

        {/* Add Relationship Form */}
        {addMode === "edge" && (
          <form
            onSubmit={handleCreateEdge}
            className="grid grid-cols-1 gap-2.5 rounded-xl border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-4"
          >
            <select
              value={edgeSrc}
              onChange={(e) => setEdgeSrc(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
            >
              {(data?.entities || []).map((e) => (
                <option key={e.id} value={e.id}>
                  From: {e.name} [{e.domainKey}]
                </option>
              ))}
            </select>
            <select
              value={edgePred}
              onChange={(e) => setEdgePred(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold"
            >
              {PREDICATES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={edgeTgt}
              onChange={(e) => setEdgeTgt(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
            >
              {(data?.entities || []).map((e) => (
                <option key={e.id} value={e.id}>
                  To: {e.name} [{e.domainKey}]
                </option>
              ))}
            </select>
            <select
              value={edgeDomain}
              onChange={(e) => setEdgeDomain(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
            >
              {(data?.domains || []).map((d) => (
                <option key={d.key} value={d.key}>
                  Edge Domain: {d.key}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={edgeEvidence}
              onChange={(e) => setEdgeEvidence(e.target.value)}
              placeholder="Supporting evidence / rationale..."
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:col-span-3"
            />
            <label className="block text-xs font-semibold">Additional permitted readers<select multiple aria-label="Graph record readers" value={entRoles.filter(r=>r!=='CEO')} onChange={e=>setEntRoles(['CEO',...Array.from(e.target.selectedOptions, o=>o.value)])} className="block w-full rounded border bg-white p-2">
              {[...principalOptions(roster).filter(o=>o.value!=='CEO'), {value:'*',label:'All permitted readers (*)'}].map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select></label>
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setAddMode("none")}
                className="rounded-lg px-2.5 py-1.5 text-xs text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                Link Entities
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Interactive SVG Graph + Entity Inspector */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-slate-800">
              <Network className="h-4 w-4 text-blue-600" />
              <span>
                {data?.stats.visibleEntities ?? 0} Entities ·{" "}
                {data?.stats.visibleRelationships ?? 0} Relationships (
                {data?.stats.crossDomainRelationships ?? 0} cross-domain)
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0.5 w-4 bg-slate-500" /> Intra-domain
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-blue-600" />{" "}
                Cross-domain
              </span>
            </div>
          </div>

          {loading && !data ? (
            <div className="flex h-[460px] items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Loading domain-tagged Knowledge Graph...
            </div>
          ) : (
            <svg
              viewBox="0 0 960 540"
              className="h-[460px] w-full bg-slate-50/40 select-none"
            >
              <defs>
                <marker
                  id="kg-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748B" />
                </marker>
                <marker
                  id="kg-arrow-cross"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563EB" />
                </marker>
              </defs>

              {/* Soft Domain Cluster Halos */}
              {(domain === "ALL" || includeBridges) &&
                (data?.domains || []).map((d) => {
                  const hub = DOMAIN_CENTERS[d.key];
                  if (!hub) return null;
                  const hasNodes = (data?.entities || []).some(
                    (e) => e.domainKey === d.key
                  );
                  if (!hasNodes) return null;
                  return (
                    <g key={d.key}>
                      <ellipse
                        cx={hub.cx}
                        cy={hub.cy}
                        rx={hub.rx + 56}
                        ry={hub.rx * 0.72 + 44}
                        fill={d.colorHex}
                        fillOpacity={domain === d.key ? 0.1 : 0.045}
                        stroke={d.colorHex}
                        strokeOpacity={domain === d.key ? 0.45 : 0.2}
                        strokeDasharray="4 4"
                      />
                      <text
                        x={hub.cx}
                        y={hub.cy - hub.rx * 0.72 - 22}
                        textAnchor="middle"
                        fill={d.colorHex}
                        fontSize="10"
                        fontWeight="700"
                      >
                        {d.name.toUpperCase()} ({d.ownerRole})
                      </text>
                    </g>
                  );
                })}

              {/* Relationship Edges */}
              {(data?.relationships || []).map((rel) => {
                const p1 = positions.get(rel.sourceEntityId);
                const p2 = positions.get(rel.targetEntityId);
                if (!p1 || !p2) return null;
                const isHighlighted =
                  !selectedId ||
                  rel.sourceEntityId === selectedId ||
                  rel.targetEntityId === selectedId;
                const mx = (p1.x + p2.x) / 2;
                const my = (p1.y + p2.y) / 2 - (rel.isCrossDomain ? 14 : 0);
                const edgeColor =
                  domainMap.get(rel.domainKey)?.colorHex || "#64748B";

                return (
                  <g
                    key={rel.id}
                    opacity={isHighlighted ? 0.92 : 0.18}
                  >
                    <path
                      d={`M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}`}
                      fill="none"
                      stroke={rel.isCrossDomain ? edgeColor : "#64748B"}
                      strokeWidth={rel.isCrossDomain ? 1.9 : 1.5}
                      strokeDasharray={rel.isCrossDomain ? "5 3" : undefined}
                      markerEnd={
                        rel.isCrossDomain
                          ? "url(#kg-arrow-cross)"
                          : "url(#kg-arrow)"
                      }
                    />
                    <text
                      x={mx}
                      y={my - 4}
                      textAnchor="middle"
                      fontSize="8.2"
                      fontWeight="600"
                      fill="#334155"
                    >
                      {rel.predicate}
                    </text>
                  </g>
                );
              })}

              {/* Entity Nodes */}
              {(data?.entities || []).map((ent) => {
                const pos = positions.get(ent.id);
                if (!pos) return null;
                const color =
                  domainMap.get(ent.domainKey)?.colorHex || "#2563EB";
                const isSelected = selectedId === ent.id;
                const shortName =
                  ent.name.length > 24
                    ? `${ent.name.slice(0, 23)}…`
                    : ent.name;

                return (
                  <g
                    key={ent.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() =>
                      setSelectedId((prev) => (prev === ent.id ? null : ent.id))
                    }
                    className="cursor-pointer"
                  >
                    {isSelected && (
                      <circle
                        r={23}
                        fill="none"
                        stroke={color}
                        strokeWidth={2.5}
                        strokeOpacity={0.45}
                      />
                    )}
                    <circle
                      r={16}
                      fill={color}
                      stroke="#FFFFFF"
                      strokeWidth={2.5}
                    />
                    <text
                      y={3.5}
                      textAnchor="middle"
                      fontSize="8.5"
                      fontWeight="700"
                      fill="#FFFFFF"
                    >
                      {ent.entityType.slice(0, 3).toUpperCase()}
                    </text>
                    <rect
                      x={-72}
                      y={20}
                      width={144}
                      height={17}
                      rx={6}
                      fill="#FFFFFF"
                      fillOpacity={0.92}
                      stroke={isSelected ? color : "#CBD5E1"}
                      strokeWidth={isSelected ? 1.4 : 0.8}
                    />
                    <text
                      y={31.5}
                      textAnchor="middle"
                      fontSize="9.3"
                      fontWeight="600"
                      fill="#0F172A"
                    >
                      {shortName}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Right Column: Entity & Cross-Domain Relationship Inspector */}
        <div className="flex max-h-[505px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          {selectedEntity ? (
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="rounded-md px-2 py-0.5 text-[10px] font-bold text-white"
                      style={{
                        backgroundColor:
                          domainMap.get(selectedEntity.domainKey)?.colorHex ||
                          "#2563EB",
                      }}
                    >
                      {selectedEntity.domainKey}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                      {selectedEntity.entityType}
                    </span>
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800">
                      {selectedEntity.classificationLevel}
                    </span>
                  </div>
                  <h4 className="mt-1.5 text-sm font-bold text-slate-900">
                    {selectedEntity.name}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-xs leading-relaxed text-slate-600">
                {selectedEntity.description}
              </p>

              {selectedEntity.taxonomyConceptId && (
                <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-700">
                  SKOS: {selectedEntity.taxonomyConceptId}
                </div>
              )}

              {Object.keys(selectedEntity.attributes || {}).length > 0 && (
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(selectedEntity.attributes).map(([k, v]) => (
                    <div
                      key={k}
                      className="rounded-lg border border-slate-100 bg-slate-50 p-2"
                    >
                      <div className="text-[10px] text-slate-400">{k}</div>
                      <div className="font-mono text-xs font-bold text-slate-800">
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  ACL Read Roles
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {selectedEntity.aclReadRoles.map((r) => (
                    <span
                      key={r}
                      className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-2.5">
                <div className="mb-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Connected Relationships ({selectedEdges.length})
                </div>
                <div className="space-y-2">
                  {selectedEdges.map((r) => (
                    <div
                      key={r.id}
                      className={`rounded-xl border p-2.5 text-[11px] ${
                        r.isCrossDomain
                          ? "border-blue-200 bg-blue-50/50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1 font-semibold text-slate-800">
                        <span>{r.sourceName}</span>
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                        <span className="rounded bg-slate-900 px-1.5 py-0.2 font-mono text-[9.5px] text-white">
                          {r.predicate}
                        </span>
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                        <span>{r.targetName}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                        <span>Edge domain: {r.domainKey}</span>
                        {r.isCrossDomain && (
                          <span className="font-semibold text-blue-700">
                            {r.sourceDomain} ↔ {r.targetDomain}
                          </span>
                        )}
                      </div>
                      {r.evidence && (
                        <p className="mt-1 text-[11px] text-slate-600">
                          {r.evidence}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900">
                  Domain-Tagged Relationships
                </h4>
                {data && data.stats.aclRedactedEntities > 0 && (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                    {data.stats.aclRedactedEntities} ACL hidden
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Click any node in the graph to inspect attributes & ACLs, or
                review active subgraph triples below:
              </p>
              {(data?.relationships || []).map((r) => (
                <div
                  key={r.id}
                  onClick={() => setSelectedId(r.sourceEntityId)}
                  className={`cursor-pointer rounded-xl border p-2.5 text-[11px] transition hover:border-slate-400 ${
                    r.isCrossDomain
                      ? "border-blue-200 bg-blue-50/40"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 text-[10px]">
                    <span className="font-mono font-bold text-slate-600">
                      [{r.domainKey}] {r.predicate}
                    </span>
                    {r.isCrossDomain && (
                      <span className="rounded bg-blue-600 px-1.5 py-0.2 text-[9px] font-bold text-white">
                        Cross-Domain
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-semibold text-slate-800">
                    {r.sourceName} → {r.targetName}
                  </div>
                  {r.evidence && (
                    <div className="mt-0.5 line-clamp-2 text-[10.5px] text-slate-500">
                      {r.evidence}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
