"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  Radio,
  Server,
  Sliders,
  Sparkles,
  X,
} from "lucide-react";
import { OPENCODE_BASE_URL_PRESETS, OPENCODE_MODELS } from "@/lib/executives";

import { accentOf, type Executive } from "@/lib/roster";

export interface ClientOpencodeConfig {
  id: number;
  baseUrl: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  envHasApiKey: boolean;
  ctoModel: string;
  cfoModel: string;
  cooModel: string;
  temperature: string;
  walkTalkRounds: number;
}

interface OpencodeConfigModalProps {
  roster: Executive[];
  open: boolean;
  config: ClientOpencodeConfig;
  onClose: () => void;
  onUpdated: (updated: ClientOpencodeConfig, roster: Executive[]) => void;
}

export default function OpencodeConfigModal({
  roster,
  open,
  config,
  onClose,
  onUpdated,
}: OpencodeConfigModalProps) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [models, setModels] = useState<Record<string, string>>(() =>
    Object.fromEntries(roster.map((e) => [e.id, e.model])),
  );
  const [saveError, setSaveError] = useState("");
  const [temperature, setTemperature] = useState(config.temperature);
  const [walkTalkRounds, setWalkTalkRounds] = useState(config.walkTalkRounds);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{
    reachable: boolean;
    mode: string;
    message: string;
  } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog) dialog.showModal();
    return () => dialog?.close();
  }, [open]);
  if (!open) return null;

  const handleTest = async () => {
    setTesting(true);
    setDiagnostic(null);
    try {
      const res = await fetch("/api/opencode-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          apiKey: apiKeyInput.trim() || undefined,
          testModel: roster[0] ? models[roster[0].id] : undefined,
        }),
      });
      const data = await res.json();
      setDiagnostic({
        reachable: Boolean(data.reachable),
        mode: data.mode || "opencode-local-runtime",
        message: data.message || "Diagnostic complete.",
      });
    } catch {
      setDiagnostic({
        reachable: false,
        mode: "opencode-local-runtime",
        message: "Embedded OpenCode Runtime active.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    setSaveError("");
    try {
      const res = await fetch("/api/opencode-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          apiKey: apiKeyInput.trim() || undefined,
          clearApiKey: clearKey,
          models,
          temperature,
          walkTalkRounds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      if (data.config) {
        onUpdated(data.config, data.roster);
        setApiKeyInput("");
        setClearKey(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
      aria-labelledby="model-settings-title"
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/45"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <h2 id="model-settings-title" className="text-base font-bold text-slate-900">
              OpenCode AI Model API Configuration
            </h2>
            <p className="text-xs text-slate-500">
              Configure OpenCode Console / Zen gateway & per-executive LLM models persisted in
              SQLite
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close model settings"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-5 p-6">
        {/* Endpoint & Auth */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <label
              htmlFor="model-base"
              className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-700 uppercase"
            >
              <Server className="h-3.5 w-3.5 text-blue-600" />
              OpenCode API Gateway URL
            </label>
            <div className="flex gap-1.5">
              {OPENCODE_BASE_URL_PRESETS.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => setBaseUrl(preset.url)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                    baseUrl === preset.url
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {preset.url.includes("/zen/") ? "Zen /v1" : "Console /openai/v1"}
                </button>
              ))}
            </div>
          </div>
          <input
            id="model-base"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://opencode.ai/inference/openai/v1"
            className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="model-key"
                className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-700 uppercase"
              >
                <KeyRound className="h-3.5 w-3.5 text-blue-600" />
                OpenCode API Key (Server-Side Vault)
              </label>
              {config.hasApiKey && !clearKey && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  {config.maskedApiKey
                    ? `Stored: ${config.maskedApiKey}`
                    : "Loaded via OPENCODE_API_KEY env"}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                id="model-key"
                type="password"
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setClearKey(false);
                }}
                placeholder={
                  config.hasApiKey
                    ? "Leave blank to keep stored key, or paste new OpenCode API key..."
                    : "Paste OPENCODE_API_KEY from opencode.ai/console (optional with embedded runtime)"
                }
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
              {config.maskedApiKey && (
                <button
                  type="button"
                  onClick={() => {
                    setClearKey(true);
                    setApiKeyInput("");
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  Clear Key
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Per-Executive OpenCode Model Selection */}
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-700 uppercase">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            C-Suite Executive Bot Model Assignments
          </h3>

          {roster.map((exec) => {
            const role = exec.id;
            const modelCtrl = {
              value: models[role],
              set: (v: string) => setModels((old) => ({ ...old, [role]: v })),
            };
            return (
              <div
                key={role}
                className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-md px-2 py-0.5 text-[11px] font-bold text-white"
                      style={{ backgroundColor: accentOf(role) }}
                    >
                      {exec.roleName}
                    </span>
                    <span className="text-xs font-semibold wrap-anywhere text-slate-900">
                      {exec.displayName}
                    </span>
                    <span className="text-[11px] wrap-anywhere text-slate-600">· {exec.job}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select
                    aria-label={`${exec.roleName} model preset`}
                    value={
                      OPENCODE_MODELS.some((m) => m.id === modelCtrl.value)
                        ? modelCtrl.value
                        : "__custom__"
                    }
                    onChange={(e) => {
                      if (e.target.value !== "__custom__") {
                        modelCtrl.set(e.target.value);
                      }
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none"
                  >
                    {OPENCODE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    <option value="__custom__">Custom OpenCode Model ID...</option>
                  </select>

                  <input
                    type="text"
                    aria-label={`${exec.roleName} model ID`}
                    value={modelCtrl.value}
                    onChange={(e) => modelCtrl.set(e.target.value)}
                    placeholder="opencode/gpt-6.1-sol"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Deliberation Cadence & Temperature */}
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="model-rounds"
              className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-700"
            >
              <span className="flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-blue-600" />
                Auto Walk & Talk Turns / Question
              </span>
              <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-blue-800">
                {walkTalkRounds} turns
              </span>
            </label>
            <input
              id="model-rounds"
              type="range"
              min={2}
              max={6}
              step={1}
              value={walkTalkRounds}
              onChange={(e) => setWalkTalkRounds(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Includes bot-to-bot Walk & Talk exchanges + final CEO consensus briefing.
            </p>
          </div>

          <div>
            <label
              htmlFor="model-temperature"
              className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-700"
            >
              <span>Reasoning Temperature</span>
              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-800">
                {temperature}
              </span>
            </label>
            <input
              id="model-temperature"
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={Number(temperature) || 0.65}
              onChange={(e) => setTemperature(e.target.value)}
              className="w-full accent-blue-600"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              0.65 balances structured quantitative rigor with natural executive debate.
            </p>
          </div>
        </div>

        {/* Diagnostic Result */}
        {diagnostic && (
          <div
            className={`rounded-xl border p-3 text-xs ${
              diagnostic.reachable
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-blue-200 bg-blue-50 text-blue-900"
            }`}
          >
            <div className="font-semibold">
              {diagnostic.reachable
                ? "OpenCode Live Cloud Gateway Verified"
                : "OpenCode Embedded Executive Runtime Ready"}
            </div>
            <p className="mt-0.5 opacity-90">{diagnostic.message}</p>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Radio className="h-3.5 w-3.5 text-blue-600" />
            )}
            Test OpenCode Gateway
          </button>

          <div className="flex items-center gap-2">
            {saveError && (
              <p role="alert" className="text-sm text-red-800">
                {saveError}
              </p>
            )}
            {saveSuccess && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                Saved to DB
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Configuration
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
