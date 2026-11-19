"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RotateCcw, X } from "lucide-react";
import { EXECUTIVE_ROLES, isExecutiveRole, type ExecutiveRole } from "@/lib/executives";
import {
  DEFAULT_PROFILES, PROFILE_FIELDS, PROFILE_KEYS, validateProfile,
  type BotProfile, type ExecutiveProfiles, type ProfileError, type ProfileField,
} from "@/lib/executive-profiles";

interface Props {
  profiles: ExecutiveProfiles;
  initialRole: ExecutiveRole;
  onSaved: (role: ExecutiveRole, profile: BotProfile) => void;
  onClose: () => void;
}

const inputStyle = "block w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:text-sm";

export default function CustomizeBotsDialog({ profiles, initialRole, onSaved, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState(initialRole);
  const [draft, setDraft] = useState(profiles[initialRole]);
  const [error, setError] = useState<ProfileError | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal(); // Native focus containment and inert background.
    return () => dialog.close();
  }, []);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function changeField(field: ProfileField, value: string) {
    setDraft({ ...draft, [field]: value });
    setError(null);
    setStatus("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const result = validateProfile(draft);
    setStatus("");
    if ("error" in result) {
      setError(result);
      if (result.field) (event.currentTarget.elements.namedItem(result.field) as HTMLElement)?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/executive-profiles/${role}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.profile), signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => null);
        setError({
          error: typeof problem?.error === "string" ? problem.error : "Could not save this profile. Try again.",
          field: PROFILE_KEYS.includes(problem?.field) ? problem.field : undefined,
        });
        return;
      }
      const saved = await res.json();
      const checked = validateProfile(saved?.profile);
      if (saved?.role !== role || "error" in checked) throw new Error("Unexpected profile response");
      const { profile } = checked;
      onSaved(role, profile);
      setDraft(profile);
      setStatus(`${role} profile saved. New turns will use these settings.`);
    } catch {
      setError({ error: "Save not confirmed. Your edits are still here; check your connection and retry." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="bot-dialog-title" onCancel={(event) => {
      event.preventDefault();
      if (!saving) close();
    }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/55">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div>
          <p className="text-xs font-semibold tracking-wider text-blue-800 uppercase">Boardroom settings</p>
          <h2 id="bot-dialog-title" className="mt-1 text-xl font-bold">Customize bots</h2>
        </div>
        <button type="button" onClick={close} disabled={saving} aria-label="Close customization" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><X size={18} /></button>
      </div>
      <form onSubmit={save} noValidate className="p-5 sm:p-6">
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <div className="rounded-xl bg-slate-50 p-3">
            <label htmlFor="bot-role" className="mb-1 block text-sm font-semibold">Executive role</label>
            <select id="bot-role" className={inputStyle} value={role} aria-describedby="bot-role-help" onChange={(event) => {
              const next = event.target.value;
              if (!isExecutiveRole(next)) return;
              setRole(next);
              setDraft(profiles[next]);
              setStatus("");
              setError(null);
            }}>
              {EXECUTIVE_ROLES.map((slot) => <option key={slot} value={slot}>{slot} · {profiles[slot].displayName}</option>)}
            </select>
            <p id="bot-role-help" className="mt-2 text-xs text-slate-600">Save before switching roles. Each bot keeps its model, memory and permissions.</p>
          </div>
          {PROFILE_KEYS.map((field) => {
            const id = `bot-${field}`;
            const invalid = error?.field === field;
            const shared = {
              id, name: field, value: draft[field], required: true, maxLength: PROFILE_FIELDS[field].max,
              className: inputStyle, "aria-invalid": invalid || undefined,
              "aria-describedby": invalid ? `${id}-error` : field === "skillPrompt" ? "bot-skill-help" : undefined,
            };
            return (
              <div key={field}>
                <label htmlFor={id} className="mb-1 block text-sm font-semibold">{PROFILE_FIELDS[field].label}</label>
                {field === "skillPrompt" ? <>
                  <textarea {...shared} rows={4} onChange={(e) => changeField(field, e.target.value)} />
                  <p id="bot-skill-help" className="mt-1 text-xs text-slate-600">Tell this bot how to approach its next AI turn. Up to 2,000 characters.</p>
                </> : <input {...shared} type="text" onChange={(e) => changeField(field, e.target.value)} />}
                {invalid && <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-800">{error.error}</p>}
              </div>
            );
          })}
          <button type="button" onClick={() => {
            setDraft(DEFAULT_PROFILES[role]);
            setError(null);
            setStatus(`Default ${role} profile loaded. Save to apply.`);
          }} className="inline-flex items-center gap-2 rounded-md py-1 text-sm font-semibold text-blue-800 hover:underline">
            <RotateCcw size={14} /> Restore defaults
          </button>
        </fieldset>
        {error && !error.field && <p role="alert" className="mt-3 text-sm text-red-800">{error.error}</p>}
        <p role="status" className="mt-2 text-sm text-slate-700">{saving ? `Saving ${role} profile…` : status}</p>
        <div className="mt-4 flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" onClick={close} disabled={saving} className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">Save</button>
        </div>
      </form>
    </dialog>
  );
}
