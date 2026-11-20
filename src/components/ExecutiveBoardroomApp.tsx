"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ChartRadar,
  ChevronRight,
  Cpu,
  Database,
  Eye,
  FastForward,
  History,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  ContactRound,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Footprints,
  UserRound,
  Layers,
  GitBranch,
  ArrowUpRight,
} from "lucide-react";
import CustomizeBotsDialog from "./CustomizeBotsDialog";
import dynamic from 'next/dynamic';
import { isActive, isExecutiveId, accentOf, type Executive, type ExecutiveId } from '@/lib/roster';
import type { DeliberationStepPlan as StepPlanPreview } from '@/lib/turn-planner';
import MemoryPanel from "./MemoryPanel";
import type { KnowledgeOsTab } from './EnterpriseKnowledgeModal';
import type { ActiveChoreography, CameraPreset } from './VirtualOfficeCanvas';
import type { ClientOpencodeConfig } from './OpencodeConfigModal';
const CeoBaselinePanel = dynamic(() => import("./CeoBaselinePanel"));
const EnterpriseKnowledgeModal = dynamic(() => import('./EnterpriseKnowledgeModal'));
const VirtualOfficeCanvas = dynamic(() => import('./VirtualOfficeCanvas'), {ssr: false});
const OpencodeConfigModal = dynamic(() => import('./OpencodeConfigModal'));
import {
  CEO_SAMPLE_DIRECTIVES,
  ROOM_ZONES,
  RoomZoneId,
} from "@/lib/executives";
import type {
  ConversationMessage,
  DeliberationSession,
  KnowledgeEntry,
} from "@/db/schema";

interface BoardroomStats {
  totalSessions: number;
  totalKnowledgeEntries: number;
  totalAppliedInsights: number;
  activeTurnCount: number;
}

type DockTab = "transcript" | "knowledge" | "memory" | "history" | "baseline";
type ComposeTarget = "NEW" | "ALL" | ExecutiveId;

export default function ExecutiveBoardroomApp({ initialRoster }: { initialRoster: Executive[] }) {
  const [roster, setRoster] = useState(initialRoster);
  const active = useMemo(() => roster.filter(isActive), [roster]);
  const byId = useMemo(() => new Map<string, Executive>(roster.map(e => [e.id,e])), [roster]);
  const labelOf = (id: string) => {const e = byId.get(id); return e ? e.roleName + (isActive(e) ? '' : ' (archived)') : id;};
  const [turnError, setTurnError] = useState('');
  const [customizing, setCustomizing] = useState(false);
  const customizeButton = useRef<HTMLButtonElement>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [sessions, setSessions] = useState<DeliberationSession[]>([]);
  const [activeSession, setActiveSession] =
    useState<DeliberationSession | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [config, setConfig] = useState<ClientOpencodeConfig>({
    id: 1,
    baseUrl: "https://opencode.ai/inference/openai/v1",
    hasApiKey: false,
    maskedApiKey: "",
    envHasApiKey: false,
    ctoModel: "opencode/deepseek-v4.1-flash-free",
    cfoModel: "opencode/mimo-v2.6-flash-free",
    cooModel: "opencode/nemotron-3.5-lightning-free",
    temperature: "0.65",
    walkTalkRounds: 4,
  });
  const [stats, setStats] = useState<BoardroomStats>({
    totalSessions: 0,
    totalKnowledgeEntries: 0,
    totalAppliedInsights: 0,
    activeTurnCount: 0,
  });

  // UI & Controls State
  const [ceoInput, setCeoInput] = useState("");
  const [showSamplePrompts, setShowSamplePrompts] = useState(false);
  const [autoWalkAndTalk, setAutoWalkAndTalk] = useState(true);
  const [isLoopRunning, setIsLoopRunning] = useState(false);
  const [isGeneratingStep, setIsGeneratingStep] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("ceo-pov");
  const [selectedExecutive, setSelectedExecutive] =
    useState<ExecutiveId | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DockTab>("transcript");
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [composeTarget, setComposeTarget] = useState<ComposeTarget>("NEW");
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0);
  const [knowledgeOsOpen, setKnowledgeOsOpen] = useState(false);
  const [knowledgeOsTab, setKnowledgeOsTab] =
    useState<KnowledgeOsTab>("mindmap");
  const [promotedIds, setPromotedIds] = useState<number[]>([]);
  const [enterpriseStats, setEnterpriseStats] = useState({
    totalDocs: 0,
    approvedDocs: 0,
    pendingReview: 0,
    entities: 0,
    relationships: 0,
    crossDomainEdges: 0,
  });

  // Knowledge Vault Filter & Manual Entry
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeRoleFilter, setKnowledgeRoleFilter] = useState<string>("ALL");
  const [addingMandate, setAddingMandate] = useState(false);
  const [mandateTopic, setMandateTopic] = useState("");
  const [mandateInsight, setMandateInsight] = useState("");
  const [mandateRole, setMandateRole] = useState<string>("JOINT");

  // 3D Choreography State
  const [choreography, setChoreography] = useState<ActiveChoreography>({
    speaker: null,
    listener: null,
    roomZone: "strategy-table",
    interactionMode: "idle",
    speechText: null,
    stageLabel: "Executives Standing Ready for CEO Directive",
    isEnriching: false,
    latestInsightTopic: null,
  });

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoWalkRef = useRef(autoWalkAndTalk);
  useEffect(() => {autoWalkRef.current = autoWalkAndTalk;}, [autoWalkAndTalk]);
  const voiceEnabledRef = useRef(voiceEnabled);
  useEffect(() => {voiceEnabledRef.current = voiceEnabled;}, [voiceEnabled]);

  const speakUtterance = useCallback((role: ExecutiveId, text: string) => {
    if (
      !voiceEnabledRef.current ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.04;
      utter.pitch = role === "CFO" ? 0.92 : role === "CTO" ? 1.08 : 1.02;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore browser speech errors
    }
  }, []);

  const loadBoardroom = useCallback(async (sessionId?: number) => {
    try {
      const url = sessionId
        ? `/api/boardroom?sessionId=${sessionId}`
        : "/api/boardroom";
      const res = await fetch(url);
      const data = await res.json();
      if (data.roster) setRoster(data.roster);
      if (!sessionId) setDockOpen(open => open || window.innerWidth >= 768);
      if (data.sessions) setSessions(data.sessions);
      if ('activeSession' in data) setActiveSession(data.activeSession);
      if (data.messages) setMessages(data.messages);
      if (data.knowledge) setKnowledge(data.knowledge);
      if (data.config) setConfig(data.config);
      if (data.stats) setStats(data.stats);
      if (data.enterpriseStats) setEnterpriseStats(data.enterpriseStats);

      if (!data.messages?.some((m: ConversationMessage) => m.senderRole !== 'CEO')) setChoreography(prev=>({...prev, speaker:null,listener:null,interactionMode:'idle',speechText:null,isEnriching:false,latestInsightTopic:null,stageLabel:'Ready for a CEO directive'}));
      // Show last message context subtly in idle state if completed
      if (data.messages && data.messages.length > 0) {
        const lastBot = [...data.messages]
          .reverse()
          .find((m: ConversationMessage) => m.senderRole !== "CEO");
        if (lastBot) {
          setChoreography({
            speaker: lastBot.senderRole as ExecutiveId,
            listener: lastBot.targetRole as ActiveChoreography["listener"],
            roomZone: (lastBot.roomZone as RoomZoneId) || "ceo-briefing",
            interactionMode: "idle",
            speechText: null,
            stageLabel: "Ready · Last Synthesis Saved in SQLite",
            isEnriching: false,
            latestInsightTopic: null,
          });
        }
      }
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    void loadBoardroom();
    return () => {
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [loadBoardroom]);

  // Refresh the chooser on return from another tab; step planning itself always reads SQLite.
  useEffect(() => {
    const controller = new AbortController();
    const refreshRoster = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch('/api/executive-profiles', {cache:'no-store',signal:controller.signal});
        if (response.ok) setRoster((await response.json()).roster);
      } catch { /* The current list remains usable; the server validates the address on send. */ }
    };
    document.addEventListener('visibilitychange', refreshRoster);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', refreshRoster); };
  }, []);

  useEffect(() => {
    if (activeTab === "transcript") {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, activeTab]);

  const executeSingleWalkTalkStep = useCallback(
    async function runStep(
      sessionId: number,
      previewPlan?: StepPlanPreview,
      continueAutonomousCycle = true
    ) {
      if (loopTimerRef.current) {
        clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }

      setIsGeneratingStep(true); setTurnError('');

      // Immediately walk the executives to their planned zone while OpenCode generates
      if (previewPlan) {
        setChoreography((prev) => ({
          ...prev,
          speaker: previewPlan.speaker,
          listener: previewPlan.listener,
          roomZone: previewPlan.roomZone,
          interactionMode: previewPlan.interactionMode,
          speechText: null,
          stageLabel: previewPlan.stageLabel,
          isEnriching: true,
        }));
      }

      try {
        const res = await fetch("/api/deliberate/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        const data = await res.json();
        if (data.roster) setRoster(data.roster);
        if (!res.ok || !data.message) {
          setTurnError(data.error || "Turn paused. Retry or retarget the question.");
          setChoreography(prev => ({...prev, speaker:null, listener:null, speechText:null, isEnriching:false, latestInsightTopic:null, stageLabel:"Turn paused"}));
          setIsLoopRunning(false);
          setIsGeneratingStep(false);
          return;
        }

        const savedMsg: ConversationMessage = data.message;
        const savedKnow: KnowledgeEntry | undefined = data.knowledgeEntry;
        const updatedSess: DeliberationSession = data.session;
        const planUsed: StepPlanPreview = data.currentPlan;
        const nextPlan: StepPlanPreview = data.nextPlan;
        const cycleCompleted = Boolean(data.cycleCompleted);

        setMessages((prev) => [...prev, savedMsg]);
        setMemoryRefreshKey((k) => k + 1);
        if (savedKnow) {
          setKnowledge((prev) => [savedKnow, ...prev]);
        }
        setActiveSession(updatedSess);
        setSessions((prev) =>
          prev.map((s) => (s.id === updatedSess.id ? updatedSess : s))
        );
        setStats((prev) => ({
          ...prev,
          totalKnowledgeEntries: savedKnow
            ? prev.totalKnowledgeEntries + 1
            : prev.totalKnowledgeEntries,
          totalAppliedInsights:
            prev.totalAppliedInsights +
            (data.recalledKnowledgeCount ? Math.min(2, data.recalledKnowledgeCount) : 0),
          activeTurnCount: prev.activeTurnCount + 1,
        }));

        // Present live speech bubble & knowledge enrichment indicator in 3D space
        setChoreography({
          speaker: planUsed.speaker,
          listener: planUsed.listener,
          roomZone: planUsed.roomZone,
          interactionMode: planUsed.interactionMode,
          speechText: savedMsg.content,
          stageLabel: planUsed.stageLabel,
          isEnriching: false,
          latestInsightTopic: savedKnow?.topic || null,
        });

        speakUtterance(planUsed.speaker, savedMsg.content);
        setIsGeneratingStep(false);

        if (
          continueAutonomousCycle &&
          autoWalkRef.current &&
          !cycleCompleted
        ) {
          setIsLoopRunning(true);
          loopTimerRef.current = setTimeout(() => {
            void runStep(sessionId, nextPlan, true);
          }, 4700);
        } else {
          setIsLoopRunning(false);
          // Clear speech bubble gently after consensus presentation settles
          loopTimerRef.current = setTimeout(() => {
            setChoreography((prev) => ({
              ...prev,
              interactionMode: "idle",
              speechText: null,
              latestInsightTopic: null,
              stageLabel: cycleCompleted
                ? "Executive Consensus Reached & Persisted to DB"
                : "Walk & Talk Paused · Ready for Next Turn",
            }));
          }, 6800);
        }
      } catch (err) {
        setTurnError("Turn not confirmed. Refresh the session before retrying.");
        console.error("Deliberation step failed:", err);
        setIsGeneratingStep(false);
        setIsLoopRunning(false);
      }
    },
    [speakUtterance]
  );

  const handleCeoFollowUp = async (content: string, target: "ALL" | ExecutiveId) => {
    if (!activeSession) return;
    setTurnError('');
    setShowSamplePrompts(false);
    setActiveTab("transcript");
    if (window.innerWidth >= 768) setDockOpen(true);
    try {
      const res = await fetch("/api/ceo-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSession.id, content, targetRole: target }),
      });
      const data = await res.json();
      if (!res.ok || !data.message) { setTurnError(data.error || 'Could not send follow-up.'); await loadBoardroom(activeSession.id); return; }
      setCeoInput('');
      setMessages((prev) => [...prev, data.message as ConversationMessage]);
      if (data.session) {
        const s = data.session as DeliberationSession;
        setActiveSession(s);
        setSessions((prev) => prev.map((x) => (x.id === s.id ? s : x)));
      }
      setMemoryRefreshKey((k) => k + 1);
      setIsLoopRunning(autoWalkAndTalk);
      executeSingleWalkTalkStep(activeSession.id, data.nextPlan as StepPlanPreview, autoWalkAndTalk);
    } catch (err) {
      setTurnError("Could not confirm follow-up. Refresh before retrying.");
      console.error("Failed to send CEO follow-up:", err);
    }
  };

  const handleSubmitCeoDirective = async (
    e?: React.FormEvent,
    overrideQuestion?: string
  ) => {
    if (e) e.preventDefault();
    const questionText = (overrideQuestion ?? ceoInput).trim();
    if (!questionText || isGeneratingStep) return;

    if (composeTarget !== "NEW" && activeSession && !overrideQuestion) {
      if (loopTimerRef.current) {
        clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }
      await handleCeoFollowUp(questionText, composeTarget);
      return;
    }

    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }

    setTurnError('');
    setShowSamplePrompts(false);
    setActiveTab("transcript");
    if (window.innerWidth >= 768) setDockOpen(true);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ceoQuestion: questionText,
          targetRole: overrideQuestion || composeTarget === "NEW" ? "ALL" : composeTarget,
          autoWalkAndTalk,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.session) {setTurnError(data.error || 'Could not start session.'); return;}
      setCeoInput('');

      const createdSession: DeliberationSession = data.session;
      const ceoMsg: ConversationMessage = data.ceoMessage;
      const firstPlan: StepPlanPreview = data.firstStepPlan;

      setSessions((prev) => [createdSession, ...prev]);
      setActiveSession(createdSession);
      setMessages([ceoMsg]);
      setMemoryRefreshKey((k) => k + 1);
      setStats((prev) => ({
        ...prev,
        totalSessions: prev.totalSessions + 1,
        activeTurnCount: 1,
      }));

      if (cameraPreset === "ceo-pov") {
        setCameraPreset("follow-huddle");
      }

      if (autoWalkAndTalk) {
        setIsLoopRunning(true);
        executeSingleWalkTalkStep(createdSession.id, firstPlan, true);
      } else {
        // Run initial response turn if auto walk-and-talk is toggled off
        executeSingleWalkTalkStep(createdSession.id, firstPlan, false);
      }
    } catch (err) {
      setTurnError("Could not confirm directive. Refresh before retrying.");
      console.error("Failed to issue CEO directive:", err);
    }
  };

  const handleTriggerExtraWalkTalk = () => {
    if (!active.length || !activeSession || isGeneratingStep) return;
    setActiveTab("transcript");
    setDockOpen(true);
    setIsLoopRunning(autoWalkAndTalk);
    executeSingleWalkTalkStep(activeSession.id, undefined, autoWalkAndTalk);
  };

  const handlePauseLoop = () => {
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    setIsLoopRunning(false);
    setChoreography((prev) => ({
      ...prev,
      stageLabel: "Auto Walk & Talk Paused by CEO",
    }));
  };

  const handleSelectSession = async (session: DeliberationSession) => {
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    setIsLoopRunning(false);
    await loadBoardroom(session.id);
    setActiveTab("transcript");
  };

  const handleDeleteSession = async (id: number, ev: React.MouseEvent) => {
    ev.stopPropagation();
    await fetch(`/api/sessions?id=${id}`, { method: "DELETE" });
    const nextSessions = sessions.filter((s) => s.id !== id);
    setSessions(nextSessions);
    if (activeSession?.id === id) {
      if (nextSessions[0]) {
        await loadBoardroom(nextSessions[0].id);
      } else {
        setActiveSession(null);
        setMessages([]);
      }
    }
  };

  const handleAddMandate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mandateTopic.trim() || !mandateInsight.trim()) return;
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contributorRole: mandateRole,
        topic: mandateTopic.trim(),
        insight: mandateInsight.trim(),
        category:
          mandateRole === "CTO"
            ? "architecture"
            : mandateRole === "CFO"
            ? "finance"
            : mandateRole === "COO"
            ? "operations"
            : "cross-functional",
        tags: ["ceo-principle", "boardroom-guardrail"],
      }),
    });
    const data = await res.json();
    if (data.knowledgeEntry) {
      setKnowledge((prev) => [data.knowledgeEntry, ...prev]);
      setStats((prev) => ({
        ...prev,
        totalKnowledgeEntries: prev.totalKnowledgeEntries + 1,
      }));
      setMandateTopic("");
      setMandateInsight("");
      setAddingMandate(false);
    }
  };

  const openKnowledgeOs = (targetTab: KnowledgeOsTab = "mindmap") => {
    setKnowledgeOsTab(targetTab);
    setKnowledgeOsOpen(true);
  };

  const handlePromoteInsightToEnterpriseKb = async (k: KnowledgeEntry) => {
    const res = await fetch("/api/v1/enterprise/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: k.topic,
        content: `${k.insight}\n\nSynthesized with ${k.contributorRole} (${k.confidenceScore}% confidence). Tags: ${(k.tags || []).join(", ")}.`,
        docType: "board_memo",
        domainKey: "auto",
        metadata: {
          author: `${k.contributorRole} (Promoted by CEO)`,
          sourceSystem: "Boardroom Promotion Gate",
          promotedFromNoteId: k.id,
          tags: k.tags || [],
        },
        extractGraph: true,
      }),
    });
    if (res.ok) {
      setPromotedIds((prev) => [...prev, k.id]);
      setEnterpriseStats((prev) => ({
        ...prev,
        totalDocs: prev.totalDocs + 1,
        pendingReview: prev.pendingReview + 1,
      }));
    }
  };

  const handleDeleteKnowledge = async (id: number) => {
    await fetch(`/api/knowledge?id=${id}`, { method: "DELETE" });
    setKnowledge((prev) => prev.filter((k) => k.id !== id));
    setStats((prev) => ({
      ...prev,
      totalKnowledgeEntries: Math.max(0, prev.totalKnowledgeEntries - 1),
    }));
  };

  const filteredKnowledge = knowledge.filter((item) => {
    if (
      knowledgeRoleFilter !== "ALL" &&
      item.contributorRole !== knowledgeRoleFilter
    ) {
      return false;
    }
    if (knowledgeQuery.trim()) {
      const q = knowledgeQuery.toLowerCase();
      const hay = `${item.topic} ${item.insight} ${(item.tags || []).join(
        " "
      )}`.toLowerCase();
      return hay.includes(q);
    }
    return true;
  });

  const selectedExecProfile = active.find(e => e.id === selectedExecutive);
  const targetMember = active.find(e => e.id === composeTarget);
  const staleTarget = composeTarget !== 'NEW' && composeTarget !== 'ALL' && !targetMember;
  const speaker = active.find(e => e.id === choreography.speaker);
  const listener = active.find(e => e.id === choreography.listener);
  const validStage = speaker && (!choreography.listener || choreography.listener === 'CEO' || listener);
  const selectedExecInsightsCount = selectedExecutive
    ? knowledge.filter(
        (k) =>
          k.contributorRole === selectedExecutive ||
          k.collaboratorRole === selectedExecutive
      ).length
    : 0;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      {/* Top Glassmorphic Executive Bar */}
      <header className="z-30 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200/80 bg-white/88 px-3 py-2 backdrop-blur-md lg:flex-nowrap lg:px-4">
        {/* Brand & CEO Identity */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
            <Building2 className="h-4.5 w-4.5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-slate-900">
                AETHER 3D EXECUTIVE SUITE
              </span>
              <button type="button" onClick={() => { setActiveTab("baseline"); setDockOpen(true); }}
                title="Open the CEO knowledge baseline" aria-controls={dockOpen ? "intelligence-dock" : undefined}
                className="inline-flex min-h-7 items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[10px] font-bold tracking-wide text-white uppercase hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                <ChartRadar aria-hidden="true" className="h-3.5 w-3.5 text-teal-200" /> CEO radar
              </button>
            </div>
            <p className="hidden text-[11px] text-slate-500 md:block">
              Executive deliberations · Live roster
            </p>
          </div>
        </div>

        {/* Active CEO Directive Anchor Pill */}
        {activeSession && (
          <div className="hidden min-w-0 max-w-xl flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/90 px-3.5 py-1.5 xl:flex">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                isLoopRunning || isGeneratingStep
                  ? "animate-ping bg-blue-600"
                  : "bg-emerald-500"
              }`}
            />
            <span className="shrink-0 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
              Active Question:
            </span>
            <span className="truncate text-xs font-medium text-slate-800">
              {activeSession.ceoQuestion}
            </span>
          </div>
        )}

        {/* Right Controls: Auto Walk-and-Talk, Audio, DB Telemetry, OpenCode Config */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Auto Walk & Talk Switch */}
          <button
            type="button"
            onClick={() => setAutoWalkAndTalk((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              autoWalkAndTalk
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            aria-label="Automatic Walk & Talk" aria-pressed={autoWalkAndTalk} title="Toggle automatic multi-turn Walk & Talk"
          >
            <Footprints className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Auto Walk & Talk:</span>
            <span className="font-bold">{autoWalkAndTalk ? "ON" : "OFF"}</span>
          </button>

          {/* Voice Toggle */}
          <button
            type="button"
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              if (
                !next &&
                typeof window !== "undefined" &&
                "speechSynthesis" in window
              ) {
                window.speechSynthesis.cancel();
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
              voiceEnabled
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            title="Toggle spoken executive audio"
          >
            {voiceEnabled ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
            <span className="hidden xl:inline">
              {voiceEnabled ? "Audio ON" : "Muted"}
            </span>
          </button>

          {/* CEO Persona Memory */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("memory");
              setDockOpen(true);
            }}
            className="hidden items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 md:inline-flex"
            title="Open your living CEO_PERSONA.md memory"
          >
            <UserRound className="h-3.5 w-3.5" />
            <span>My Persona</span>
          </button>

          {/* Enterprise AI Knowledge & Memory Layer (Knowledge OS) */}
          <button
            type="button"
            onClick={() => openKnowledgeOs("mindmap")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-800"
            title="Open CEO Enterprise Knowledge OS (Mindmap, Domain KBs, ACLs, YAML/SKOS Taxonomy, Knowledge Graph & REST API)"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Knowledge OS</span>
            {enterpriseStats.pendingReview > 0 && (
              <span className="rounded-full bg-amber-300 px-1.5 py-0.2 font-mono text-[10px] font-bold text-slate-950">
                {enterpriseStats.pendingReview}
              </span>
            )}
          </button>

          {/* DB Knowledge Counter */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("knowledge");
              setDockOpen(true);
            }}
            className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 xl:inline-flex"
          >
            <Database className="h-3.5 w-3.5 text-teal-600" />
            <span>{stats.totalKnowledgeEntries} Notes</span>
          </button>

          <button type="button" ref={customizeButton} onClick={() => setCustomizing(true)} aria-haspopup="dialog"
            className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">
            <ContactRound className="h-3.5 w-3.5" /> Customize bots
          </button>

          {/* OpenCode AI Model API Config Button */}
          <button
            type="button"
            onClick={() => setConfigModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800"
          >
            <Cpu className="h-3.5 w-3.5 text-blue-400" />
            <span>OpenCode API</span>
            <Settings2 className="h-3.5 w-3.5 opacity-75" />
          </button>

          {/* Toggle Right Intelligence Dock */}
          <button
            type="button"
            onClick={() => setDockOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50"
            aria-expanded={dockOpen} aria-controls={dockOpen ? "intelligence-dock" : undefined}
            title="Toggle Boardroom Intelligence Panel"
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform ${
                dockOpen ? "" : "rotate-180"
              }`}
            />
          </button>
        </div>
      </header>

      {/* Main Workspace: Full-Bleed 3D Virtual Office + Right Intelligence Dock */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* A full-width mobile dock covers the room; keep its controls out of keyboard navigation. */}
        <div className={`relative flex-1 overflow-hidden ${dockOpen ? "hidden sm:block" : ""}`}>
          {loadingInitial ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-100">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <p className="text-sm font-semibold text-slate-700">
                Initializing 3D Virtual Executive Boardroom & SQLite Memory...
              </p>
            </div>
          ) : (
            <VirtualOfficeCanvas
              speaker={validStage ? speaker : undefined} listener={validStage ? listener : undefined}
              choreography={choreography}
              cameraPreset={cameraPreset}
              selectedExecutive={selectedExecutive}
              onSelectExecutive={(role) => {
                setSelectedExecutive((prev) => (prev === role ? null : role));
                setCameraPreset(`focus-${role}` as CameraPreset);
              }}
            />
          )}

          {/* Top-Left Camera Vantage & Spatial Room Legend */}
          <div className="pointer-events-auto absolute top-2 left-2 right-2 sm:right-auto z-20 flex max-w-full flex-col items-start gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/88 p-1.5 shadow-sm backdrop-blur-md">
              {(
                [
                  { id: "ceo-pov", label: "CEO POV" },
                  { id: "follow-huddle", label: "Follow Walk & Talk" },
                  { id: "boardroom-overview", label: "Room Orbit" },

                ] as Array<{ id: CameraPreset; label: string }>
              ).map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => {
                    setCameraPreset(cam.id);
                    setSelectedExecutive(null);
                  }}
                  className={`rounded-xl px-2.5 py-1 text-[11px] font-semibold transition ${
                    cameraPreset === cam.id
                      ? "bg-blue-700 text-white shadow-2xs"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {cam.label}
                </button>
              ))}
            </div>

            <label className="flex max-w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">Roster
              <select aria-label="Select executive" value={selectedExecProfile?.id || ''} className="max-w-44 min-w-0 rounded bg-slate-50 px-1 py-1" onChange={e => {
                const id = e.target.value; setSelectedExecutive(isExecutiveId(id) ? id : null); setCameraPreset(isExecutiveId(id) ? `focus-${id}` : 'ceo-pov');
              }}><option value="">{active.length} active executives</option>{active.map(e=><option key={e.id} value={e.id}>{e.roleName} · {e.displayName}</option>)}</select>
            </label>
            {/* Selected Executive Dossier Card */}
            {selectedExecProfile && (
              <div className="w-72 rounded-2xl border border-slate-200/90 bg-white/92 p-3.5 shadow-lg backdrop-blur-md">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
                        style={{
                          backgroundColor: accentOf(selectedExecProfile.id),
                        }}
                      >
                        {selectedExecProfile.roleName}
                      </span>
                      <h3 className="text-xs font-bold wrap-anywhere text-slate-900">
                        {selectedExecProfile.displayName}
                      </h3>
                    </div>
                    <p className="mt-0.5 text-[11px] font-medium wrap-anywhere text-slate-600">
                      {selectedExecProfile.job}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedExecutive(null);
                      setCameraPreset("ceo-pov");
                    }}
                    className="text-[11px] font-medium text-slate-400 hover:text-slate-700"
                  >
                    Reset View
                  </button>
                </div>
                <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed whitespace-pre-line wrap-anywhere text-slate-600">
                  {selectedExecProfile.skillPrompt}
                </p>
                <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-500">
                  <span className="font-mono truncate max-w-[155px]">
                    {selectedExecProfile.model}
                  </span>
                  <span className="font-semibold text-slate-700">
                    {selectedExecInsightsCount} DB Insights
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Live Choreography Status Ribbon & Playback Controls */}
          <div className="pointer-events-none absolute right-4 bottom-24 left-4 z-20 flex flex-col items-center gap-2">
            <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-slate-200/90 bg-white/90 px-4 py-1.5 text-xs shadow-md backdrop-blur-md">
              <Activity
                className={`h-3.5 w-3.5 ${
                  isLoopRunning || isGeneratingStep
                    ? "animate-pulse text-blue-600"
                    : "text-emerald-600"
                }`}
              />
              <span className="font-semibold text-slate-800">
                {choreography.stageLabel}
              </span>

              {isGeneratingStep && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  OpenCode Synthesizing...
                </span>
              )}

              {activeSession && active.length > 0 && !isGeneratingStep && (
                <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                  {isLoopRunning ? (
                    <>
                      <button
                        type="button"
                        onClick={handlePauseLoop}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        <Pause className="h-3 w-3" />
                        Pause
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          executeSingleWalkTalkStep(
                            activeSession.id,
                            undefined,
                            true
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <FastForward className="h-3 w-3" />
                        Next Turn
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleTriggerExtraWalkTalk}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-blue-700"
                    >
                      <Play className="h-3 w-3" />
                      Walk & Talk on Current Question
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom CEO Strategic Directive Command Bar */}
          <div className="pointer-events-none absolute right-4 bottom-4 left-4 z-20 flex flex-col items-center">
            {showSamplePrompts && (
              <div className="pointer-events-auto mb-2 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white/96 p-3 shadow-xl backdrop-blur-md">
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  <span>Sample CEO Boardroom Directives</span>
                  <button
                    type="button"
                    onClick={() => setShowSamplePrompts(false)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    Hide
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {CEO_SAMPLE_DIRECTIVES.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        handleSubmitCeoDirective(undefined, prompt)
                      }
                      className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-2.5 text-left text-xs text-slate-700 transition hover:border-blue-300 hover:bg-blue-50/60"
                    >
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <span className="line-clamp-2">{prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(turnError || !active.length) && <p role="alert" className="pointer-events-auto mb-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-950">{turnError || 'No active executives. Add one in Customize bots to resume.'}</p>}
            <label className="pointer-events-auto mb-1 flex max-w-full items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700">CEO speaks to
              <select aria-label="Message recipient" value={composeTarget} onChange={e => {setComposeTarget(e.target.value as ComposeTarget); setTurnError('');}} className="max-w-48 min-w-0 rounded bg-slate-50 p-1">
                <option value="NEW">New question</option><option value="ALL">Whole team</option>
                {staleTarget && <option value={composeTarget} disabled>Archived — choose a recipient</option>}
                {active.map(e => <option key={e.id} value={e.id}>{e.roleName} · {e.displayName}</option>)}
              </select></label>

            <form
              onSubmit={(e) => handleSubmitCeoDirective(e)}
              className="pointer-events-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-xl backdrop-blur-md"
            >
              <button
                type="button"
                onClick={() => setShowSamplePrompts((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                title="View sample C-suite questions"
              >
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                <span className="hidden sm:inline">Prompts</span>
              </button>

              <input
                type="text"
                aria-label="CEO question" value={ceoInput}
                onChange={(e) => setCeoInput(e.target.value)}
                placeholder={
                  composeTarget === "NEW" || !activeSession
                    ? "Ask your executives a strategic question…"
                    : composeTarget === "ALL"
                    ? "Follow up with the whole C-suite on the active question..."
                    : `Ask ${targetMember?.displayName || "an active executive"} directly…`
                }
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />

              <button
                type="submit"
                disabled={!active.length || staleTarget || !ceoInput.trim() || isGeneratingStep}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-800 disabled:opacity-50"
              >
                <span>Ask C-Suite</span>
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        </div>

        {/* Right Glassmorphic Boardroom Intelligence Dock */}
        {dockOpen && (
          <aside id="intelligence-dock" aria-label="Boardroom intelligence" className="absolute inset-0 sm:static z-20 flex h-full w-full flex-col border-l border-slate-200/90 bg-white/94 backdrop-blur-md sm:w-[420px] shrink-0">
            <div role="group" aria-label="Intelligence views" className="grid shrink-0 grid-cols-5 gap-1 border-b border-slate-200 bg-slate-50 p-2">
              {([
                { id: "transcript", label: "Talk", Icon: MessageSquare, count: messages.length },
                { id: "knowledge", label: "Insights", Icon: BrainCircuit, count: knowledge.length },
                { id: "memory", label: "Memory", Icon: UserRound },
                { id: "history", label: "Sessions", Icon: History, count: sessions.length },
                { id: "baseline", label: "Radar", Icon: ChartRadar },
              ] as const).map(view => (
                <button key={view.id} type="button" onClick={() => setActiveTab(view.id)} aria-pressed={activeTab === view.id}
                  className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-blue-700 ${activeTab === view.id ? "bg-white text-blue-800 shadow-sm" : "text-slate-600 hover:bg-white"}`}>
                  <span className="flex items-center gap-1"><view.Icon aria-hidden="true" className="h-3.5 w-3.5" />
                    {"count" in view && <span className="font-mono text-[10px]">{view.count}</span>}
                  </span>
                  {view.label}
                </button>
              ))}
            </div>
            {activeTab === "baseline" && <CeoBaselinePanel />}

            {/* TAB 1: Live Walk-and-Talk Conversation Feed */}
            {activeTab === "transcript" && (
              <div className="flex flex-1 flex-col overflow-hidden">
                {activeSession ? (
                  <>
                    {/* Pinned CEO Question Context Header */}
                    <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                          Session #{activeSession.id} · Bounded CEO Question
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            activeSession.status === "completed"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-blue-50 text-blue-700"
                          }`}
                        >
                          {activeSession.status === "paused" ? "Paused" : activeSession.status === "completed"
                            ? "Consensus Saved"
                            : "Deliberating"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold leading-snug text-slate-900">
                        “{activeSession.ceoQuestion}”
                      </p>
                    </div>

                    {/* Chronological Messages Saved in SQLite */}
                    <div className="flex-1 space-y-3 overflow-y-auto p-4">
                      {messages.map((msg) => {
                        const isCeo = msg.senderRole === "CEO";
                        const exec = !isCeo
                          ? byId.get(msg.senderRole)
                          : null;
                        const zoneLabel =
                          ROOM_ZONES[msg.roomZone as RoomZoneId]?.label ||
                          msg.roomZone;

                        return (
                          <div
                            key={msg.id}
                            className={`rounded-2xl border p-3.5 transition ${
                              isCeo
                                ? "border-slate-800 bg-slate-900 text-white"
                                : msg.interactionMode === "executive_consensus"
                                ? "border-blue-200 bg-blue-50/60"
                                : "border-slate-200 bg-white shadow-2xs"
                            }`}
                          >
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
                                  style={{
                                    backgroundColor: isCeo
                                      ? "#2563EB"
                                      : accentOf(msg.senderRole),
                                  }}
                                >
                                  {labelOf(msg.senderRole)} → {labelOf(msg.targetRole)}
                                </span>
                                <span
                                  className={`text-xs font-semibold wrap-anywhere ${
                                    isCeo ? "text-slate-100" : "text-slate-800"
                                  }`}
                                >
                                  {isCeo ? "You (CEO)" : exec?.displayName}
                                </span>
                              </div>
                              <span
                                className={`font-mono text-[10px] ${
                                  isCeo ? "text-slate-400" : "text-slate-400"
                                }`}
                              >
                                DB #{msg.id}
                              </span>
                            </div>

                            <p
                              className={`text-xs leading-relaxed ${
                                isCeo ? "text-slate-100" : "text-slate-700"
                              }`}
                            >
                              {msg.content}
                            </p>

                            {!isCeo && (
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                                <span className="font-medium text-slate-500">
                                  📍 {zoneLabel}
                                </span>
                                <span className="font-mono">
                                  {msg.modelUsed.replace(/^opencode\//i, "")}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {isGeneratingStep && (
                        <div className="flex items-center gap-2.5 rounded-2xl border border-blue-100 bg-blue-50/60 p-3.5 text-xs text-blue-800">
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                          <span>
                            Executives walking & synthesizing next response within
                            your question...
                          </span>
                        </div>
                      )}
                      <div ref={transcriptEndRef} />
                    </div>

                    {/* Footer Action to Continue Walk-and-Talk Within Same Question */}
                    <div className="border-t border-slate-200/80 bg-slate-50/80 p-3">
                      <button
                        type="button"
                        disabled={!active.length || isGeneratingStep}
                        onClick={handleTriggerExtraWalkTalk}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white py-2 text-xs font-semibold text-blue-700 shadow-2xs transition hover:bg-blue-50 disabled:opacity-50"
                      >
                        <Footprints className="h-3.5 w-3.5" />
                        <span>
                          {isLoopRunning
                            ? "Walk & Talk Active..."
                            : "Continue Walk & Talk on This Question"}
                        </span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-slate-500">
                    Ask a strategic question below to start a C-suite Walk & Talk
                    deliberation.
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Enriched Knowledge Vault (SQLite) */}
            {activeTab === "knowledge" && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="space-y-2.5 border-b border-slate-200/80 bg-slate-50/70 p-3.5">
                  {/* Enterprise Knowledge Layer Launcher Card (Strictly Isolated Plane A) */}
                  <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-bold text-slate-900">
                          Enterprise Knowledge OS (Plane A)
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {enterpriseStats.totalDocs} KB docs ({enterpriseStats.pendingReview} review) ·{" "}
                          {enterpriseStats.entities} KG entities ·{" "}
                          {enterpriseStats.crossDomainEdges} cross-domain
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openKnowledgeOs("mindmap")}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-700 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-800"
                      >
                        <GitBranch className="h-3 w-3" />
                        Mindmap
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[10px] font-semibold">
                      {(
                        [
                          { id: "graph", label: "KG Graph" },
                          { id: "taxonomy", label: "SKOS YAML" },
                          { id: "retrieval", label: "ACL Search" },
                          { id: "api", label: "REST API" },
                        ] as Array<{ id: KnowledgeOsTab; label: string }>
                      ).map((shortcut) => (
                        <button
                          key={shortcut.id}
                          type="button"
                          onClick={() => openKnowledgeOs(shortcut.id)}
                          className="rounded-md border border-blue-200/80 bg-white py-1 text-blue-800 hover:bg-blue-50"
                        >
                          {shortcut.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-0.5">
                    <div className="text-xs font-bold text-slate-800">
                      Session Walk & Talk Notes (Plane B)
                    </div>
                    <button
                      type="button"
                      onClick={() => setAddingMandate((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
                    >
                      <Plus className="h-3 w-3" />
                      Add Note
                    </button>
                  </div>

                  {/* Search & Role Filter */}
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={knowledgeQuery}
                      onChange={(e) => setKnowledgeQuery(e.target.value)}
                      placeholder="Search enriched insights, topics, tags..."
                      className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <label className="block text-xs font-semibold">Contributor <select className="max-w-full rounded border bg-white p-1" value={knowledgeRoleFilter} onChange={e=>setKnowledgeRoleFilter(e.target.value)}>
                    {['ALL','JOINT',...roster.map(e=>e.id)].map(id=><option key={id} value={id}>{labelOf(id)}</option>)}</select></label>

                  {/* Optional Add CEO Institutional Principle Form */}
                  {addingMandate && (
                    <form
                      onSubmit={handleAddMandate}
                      className="space-y-2 rounded-xl border border-blue-200 bg-white p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-700">
                          Pin Institutional Principle to DB
                        </span>
                        <select
                          value={mandateRole}
                          onChange={(e) => setMandateRole(e.target.value)}
                          className="rounded border border-slate-200 px-2 py-0.5 text-[11px]"
                        >
                          <option value="JOINT">JOINT (All C-Suite)</option>
                          {active.map(e=><option key={e.id} value={e.id}>{e.roleName}</option>)}
                        </select>
                      </div>
                      <input
                        type="text"
                        value={mandateTopic}
                        onChange={(e) => setMandateTopic(e.target.value)}
                        placeholder="Principle title (e.g. Minimum 75% Gross Margin Floor)"
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                      />
                      <textarea
                        rows={2}
                        value={mandateInsight}
                        onChange={(e) => setMandateInsight(e.target.value)}
                        placeholder="Actionable knowledge that the executives will recall in future deliberations..."
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAddingMandate(false)}
                          className="rounded-lg px-2.5 py-1 text-[11px] text-slate-500"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="rounded-lg bg-blue-700 px-3 py-1 text-[11px] font-semibold text-white"
                        >
                          Save to SQLite
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Stored Knowledge Cards */}
                <div className="flex-1 space-y-2.5 overflow-y-auto p-3.5">
                  {filteredKnowledge.map((k) => {
                    const roleAccent =
                      k.contributorRole === "CTO"
                        ? "#2563EB"
                        : k.contributorRole === "CFO"
                        ? "#0D9488"
                        : k.contributorRole === "COO"
                        ? "#D97706"
                        : "#0F172A";

                    return (
                      <div
                        key={k.id}
                        className="group rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-slate-300"
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
                              style={{ backgroundColor: roleAccent }}
                            >
                              {labelOf(k.contributorRole)}
                              {k.collaboratorRole &&
                              k.collaboratorRole !== "ALL"
                                ? ` × ${labelOf(k.collaboratorRole)}`
                                : ""}
                            </span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 capitalize">
                              {k.category}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-semibold text-emerald-700">
                              {k.confidenceScore}% conf
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteKnowledge(k.id)}
                              className="opacity-0 transition group-hover:opacity-100 text-slate-400 hover:text-rose-600"
                              title="Remove insight"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <h4 className="text-xs font-bold text-slate-900">
                          {k.topic}
                        </h4>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          {k.insight}
                        </p>

                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-2">
                          <div className="flex flex-wrap gap-1">
                            {(k.tags || []).slice(0, 3).map((tag, i) => (
                              <span
                                key={i}
                                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-500"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            {promotedIds.includes(k.id) ? (
                              <span className="text-[10px] font-semibold text-emerald-700">
                                Queued in KB ✓
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  handlePromoteInsightToEnterpriseKb(k)
                                }
                                className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                                title="Explicitly promote this conversational note into the governed Enterprise KB for SKOS auto-classification & CEO review"
                              >
                                Promote → KB
                                <ArrowUpRight className="h-2.5 w-2.5" />
                              </button>
                            )}
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                              <BookOpen className="h-3 w-3" />
                              {k.appliedCount}x
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {filteredKnowledge.length === 0 && (
                    <div className="py-10 text-center text-xs text-slate-400">
                      No matching knowledge entries found.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: CEO Persona & Long-Term Executive Memory */}
            {activeTab === "memory" && (
              <MemoryPanel roster={roster} refreshKey={memoryRefreshKey} />
            )}

            {/* TAB 3: Saved SQLite CEO Question Archive */}
            {activeTab === "history" && (
              <div className="flex-1 space-y-2.5 overflow-y-auto p-3.5">
                <div className="px-1 text-[11px] font-semibold text-slate-500">
                  Select any previous CEO question to inspect its transcript or
                  trigger additional Walk & Talk rounds:
                </div>

                {sessions.map((sess) => {
                  const isCurrent = activeSession?.id === sess.id;
                  return (
                    <div
                      key={sess.id}
                      onClick={() => handleSelectSession(sess)}
                      className={`group cursor-pointer rounded-2xl border p-3.5 transition ${
                        isCurrent
                          ? "border-blue-600 bg-blue-50/50 shadow-xs"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold text-slate-400">
                            SESSION #{sess.id}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              sess.status === "completed"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-blue-50 text-blue-700"
                            }`}
                          >
                            {sess.status === "completed" && (
                              <CheckCircle2 className="h-2.5 w-2.5" />
                            )}
                            {sess.turnCount} bot turns
                          </span>
                        </div>

                        {sessions.length > 1 && (
                          <button
                            type="button"
                            onClick={(ev) => handleDeleteSession(sess.id, ev)}
                            className="opacity-0 transition group-hover:opacity-100 text-slate-400 hover:text-rose-600"
                            title="Delete session"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <p className="text-xs font-semibold leading-snug text-slate-900">
                        “{sess.ceoQuestion}”
                      </p>

                      {sess.executiveSummary && (
                        <p className="mt-1.5 line-clamp-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-700">
                            Consensus:{" "}
                          </span>
                          {sess.executiveSummary}
                        </p>
                      )}

                      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="inline-flex items-center gap-1 font-medium text-blue-600">
                          <Eye className="h-3 w-3" />
                          {isCurrent
                            ? "Currently Loaded in 3D Suite"
                            : "Load & Resume Walk-and-Talk"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* CEO Enterprise AI Knowledge & Memory OS Studio */}
      {knowledgeOsOpen && <EnterpriseKnowledgeModal roster={active}
        open={knowledgeOsOpen}
        initialTab={knowledgeOsTab}
        onClose={() => setKnowledgeOsOpen(false)}
        onStatsChanged={() => loadBoardroom(activeSession?.id)}
      />}

      {customizing && <CustomizeBotsDialog
        roster={roster} initialId={selectedExecutive}
        onSaved={rows => {
          setRoster(rows); setTurnError(''); setMemoryRefreshKey(k=>k+1);
          if (!rows.some(isActive)) handlePauseLoop();
        }}
        onClose={() => { setCustomizing(false); customizeButton.current?.focus(); }}
      />}

      {/* OpenCode AI Model API Configuration Modal */}
      {configModalOpen && <OpencodeConfigModal
        roster={active}
        open={configModalOpen}
        config={config}
        onClose={() => setConfigModalOpen(false)}
        onUpdated={(updated, rows) => {setConfig(updated); setRoster(rows);}}
      />}
    </div>
  );
}
