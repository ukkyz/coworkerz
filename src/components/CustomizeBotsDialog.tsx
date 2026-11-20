"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Archive, Plus, RotateCcw, X } from "lucide-react";
import { isExecutiveRole, EXECUTIVES } from "@/lib/executives";
import {
  DEFAULT_PROFILES,
  PROFILE_FIELDS,
  PROFILE_KEYS,
  validateProfile,
  type BotProfile,
} from "@/lib/executive-profiles";
import {
  isActive,
  PRESETS,
  profileOf,
  ROLE_SUGGESTIONS,
  type Executive,
  type ExecutiveId,
} from "@/lib/roster";

type Action = "edit" | "add" | "replace" | "remove";
type Draft = BotProfile & { roleName: string; model: string; preset: string };
const blank = (): Draft => ({
  roleName: "",
  displayName: "",
  job: "",
  skillPrompt: "",
  model: EXECUTIVES.CTO.defaultModel,
  preset: "",
});
const from = (e: Executive): Draft => ({
  ...profileOf(e),
  roleName: e.roleName,
  model: e.model,
  preset: e.preset,
});
const input =
  "mt-1 block w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 py-2 text-base font-normal text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700 sm:text-sm";
const label = "block text-sm font-semibold text-slate-800";

export default function CustomizeBotsDialog({
  roster,
  initialId,
  onSaved,
  onClose,
}: {
  roster: Executive[];
  initialId: ExecutiveId | null;
  onSaved: (roster: Executive[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const focusAfterSave = useRef<string | null>(null);
  const members = roster.filter(isActive),
    archive = roster.filter((e) => !isActive(e));
  const initial = members.find((e) => e.id === initialId) ?? members[0];
  const [id, setId] = useState<ExecutiveId | undefined>(initial?.id);
  const member = members.find((e) => e.id === id);
  const [mode, setMode] = useState<Action>(initial ? "edit" : "add");
  const [draft, setDraft] = useState<Draft>(() => (initial ? from(initial) : blank()));
  const [error, setError] = useState<{ error: string; field?: string } | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const fresh = mode === "add" || mode === "replace";

  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useLayoutEffect(() => {
    if (!saving && focusAfterSave.current) {
      const field = formRef.current?.elements.namedItem(focusAfterSave.current);
      if (field instanceof HTMLElement) field.focus();
      focusAfterSave.current = null;
    }
  }, [saving]);
  function close() {
    ref.current?.close();
    onClose();
  }
  function choose(action: Action, e: Executive | undefined) {
    setId(e?.id);
    setMode(action);
    setDraft(action === "edit" && e ? from(e) : blank());
    setError(null);
    setStatus("");
  }
  function change(field: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    setError(null);
    setStatus("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const fail = (error: string, field?: string) => {
      setError({ error, field });
      if (field) (form.elements.namedItem(field) as HTMLElement | null)?.focus();
    };
    setStatus("");
    if (mode !== "remove") {
      if (fresh && !draft.roleName.trim())
        return fail("Enter a role title or choose a suggestion.", "roleName");
      const checked = validateProfile(profileOf(draft));
      if ("error" in checked) return fail(checked.error, checked.field);
      if (!draft.model.trim()) return fail("Enter a model ID.", "model");
      if (!draft.preset) return fail("Review and select an enterprise access preset.", "preset");
    }
    focusAfterSave.current = "save";
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/executive-profiles${mode === "add" ? "" : `/${id}`}`, {
        method: mode === "edit" ? "PUT" : mode === "remove" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body:
          mode === "remove"
            ? undefined
            : JSON.stringify({
                ...profileOf(draft),
                model: draft.model,
                preset: draft.preset,
                ...(fresh && { roleName: draft.roleName }),
              }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.field) focusAfterSave.current = data.field;
        fail(data.error || "Could not save executive settings.", data.field);
        return;
      }
      const next: Executive[] = data.roster;
      const e: Executive | undefined = data.executive ?? next.find(isActive);
      focusAfterSave.current = e ? "member" : "roleName";
      onSaved(next);
      choose(e ? "edit" : "add", e);
      setStatus(
        mode === "edit"
          ? `${member?.roleName} profile saved.`
          : mode === "remove"
            ? `${member?.roleName} archived. History preserved.`
            : `${e?.roleName} added${mode === "replace" ? `; ${member?.roleName} archived` : ""}.`,
      );
    } catch {
      fail("Save not confirmed. Check your connection and review the roster before retrying.");
    } finally {
      setSaving(false);
    }
  }
  const a11y = (key: keyof Draft) => ({
    name: key,
    "aria-invalid": error?.field === key || undefined,
    "aria-describedby": error?.field === key ? "roster-error" : undefined,
  });
  return (
    <dialog
      ref={ref}
      aria-labelledby="bot-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) close();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/55"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-blue-800 uppercase">
            Boardroom settings
          </p>
          <h2 id="bot-dialog-title" className="mt-1 text-xl font-bold">
            Customize bots
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {members.length} active · {archive.length} archived
          </p>
        </div>
        <button
          type="button"
          aria-label="Close customization"
          disabled={saving}
          onClick={close}
          className="rounded-lg p-2 hover:bg-slate-100"
        >
          <X size={18} />
        </button>
      </div>
      <form ref={formRef} onSubmit={save} noValidate className="space-y-4 p-5">
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <div className="flex items-end gap-2 rounded-xl bg-slate-50 p-3">
            <label className={`${label} min-w-0 flex-1`}>
              Executive role
              <select
                name="member"
                className={input}
                value={mode === "add" ? "" : id || ""}
                onChange={(ev) =>
                  choose(
                    "edit",
                    members.find((e) => e.id === ev.target.value),
                  )
                }
              >
                <option value="" disabled>
                  New executive
                </option>
                {members.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.roleName} · {e.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => choose("add", undefined)}
              className="flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 p-2 text-sm font-semibold text-blue-800"
            >
              <Plus size={16} /> Add executive
            </button>
          </div>
          {member && mode !== "add" && (
            <div className="flex flex-wrap gap-2" aria-label="Executive action">
              {(["edit", "replace", "remove"] as const).map((a) => (
                <button
                  type="button"
                  key={a}
                  aria-pressed={mode === a}
                  onClick={() => choose(a, member)}
                  className={`rounded-md px-2.5 py-2 text-xs font-semibold ${mode === a ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
                >
                  {a === "edit"
                    ? "Edit profile"
                    : a === "replace"
                      ? "Replace executive"
                      : "Remove executive"}
                </button>
              ))}
            </div>
          )}
          {(mode === "replace" || mode === "remove") && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <b>{member?.roleName} will leave the active roster.</b> Its history and private
              journal stay available to the CEO.
              {mode === "replace" &&
                " The new executive gets a separate identity, empty personal recall and only the access you select below."}
            </p>
          )}
          {mode !== "remove" && (
            <>
              {fresh && (
                <div className="space-y-3">
                  <label className={label}>
                    Suggested role
                    <select
                      className={input}
                      value={ROLE_SUGGESTIONS.includes(draft.roleName) ? draft.roleName : ""}
                      onChange={(e) => change("roleName", e.target.value)}
                    >
                      <option value="">Custom title</option>
                      {ROLE_SUGGESTIONS.map((title) => (
                        <option key={title}>{title}</option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>
                    Role title
                    <input
                      {...a11y("roleName")}
                      className={input}
                      maxLength={100}
                      value={draft.roleName}
                      onChange={(e) => change("roleName", e.target.value)}
                    />
                  </label>
                </div>
              )}
              {PROFILE_KEYS.map((field) => (
                <label className={label} key={field}>
                  {PROFILE_FIELDS[field].label}
                  {field === "skillPrompt" ? (
                    <textarea
                      {...a11y(field)}
                      className={input}
                      rows={3}
                      maxLength={PROFILE_FIELDS[field].max}
                      value={draft[field]}
                      onChange={(e) => change(field, e.target.value)}
                    />
                  ) : (
                    <input
                      {...a11y(field)}
                      className={input}
                      maxLength={PROFILE_FIELDS[field].max}
                      value={draft[field]}
                      onChange={(e) => change(field, e.target.value)}
                    />
                  )}
                </label>
              ))}
              <label className={label}>
                Model ID
                <input
                  {...a11y("model")}
                  className={input}
                  maxLength={200}
                  value={draft.model}
                  onChange={(e) => change("model", e.target.value)}
                />
              </label>
              <div>
                <label className={label}>
                  Enterprise access
                  <select
                    {...a11y("preset")}
                    className={input}
                    value={draft.preset}
                    onChange={(e) => change("preset", e.target.value)}
                  >
                    <option value="" disabled>
                      Select a permission preset
                    </option>
                    {!fresh && member?.preset === "legacy" && (
                      <option value="legacy">Preserve migrated access</option>
                    )}
                    {Object.entries(PRESETS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-1 text-xs text-slate-600">
                  Readers see only documents and graph records whose ACL permits them, up to the
                  selected clearance. No writes or private journal access.
                </p>
              </div>
              {mode === "edit" && id && isExecutiveRole(id) && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft({ ...draft, ...DEFAULT_PROFILES[id] });
                    setStatus("Defaults loaded. Save to apply.");
                  }}
                  className="flex items-center gap-1 text-sm font-semibold text-blue-800"
                >
                  <RotateCcw size={14} /> Restore defaults
                </button>
              )}
            </>
          )}
        </fieldset>
        {error && (
          <p id="roster-error" role="alert" className="text-sm text-red-800">
            {error.error}
          </p>
        )}
        <p role="status" className="text-sm text-slate-700">
          {saving ? "Saving…" : status}
        </p>
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            name="save"
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white"
          >
            {mode === "remove"
              ? "Confirm removal"
              : mode === "replace"
                ? "Confirm replacement"
                : mode === "add"
                  ? "Create executive"
                  : "Save"}
          </button>
        </div>
      </form>
      {!!archive.length && (
        <details className="border-t border-slate-200 px-5 py-4 text-sm">
          <summary className="cursor-pointer font-semibold">
            Archived executives ({archive.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {archive.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2">
                <Archive size={14} className="shrink-0" />
                <a
                  className="wrap-anywhere text-blue-800 underline"
                  href={`/api/memory/file?path=executives/${e.id}.md`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {e.roleName} · {e.displayName} — journal <small>({e.id})</small>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </dialog>
  );
}
