"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, RefreshCw } from "lucide-react";
import { CEO_TOPICS, type CeoRadar } from "@/lib/ceo-topics";
import CeoTopicRadar from "./CeoTopicRadar";

async function requestRadar(init?: RequestInit): Promise<CeoRadar> {
  const response = await fetch("/api/ceo-baseline", { ...init, cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "The CEO radar is unavailable. Refresh to retry.");
  }
  return response.json();
}
const failure = (e: unknown) =>
  e instanceof Error ? e.message : "The request failed. Refresh to retry.";
const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

export default function CeoBaselinePanel() {
  const [data, setData] = useState<CeoRadar | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const captureButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    heading.current?.focus({ preventScroll: true });
    requestRadar({ signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(failure(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);

  async function update(capture: boolean) {
    if (busy || (capture && !data)) return;
    if (capture && data?.capturedAt && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setConfirming(false);
    setError("");
    setNotice("");
    try {
      const result = await requestRadar(
        capture
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ expectedRevision: data!.revision }),
            }
          : undefined,
      );
      setData(result);
      setNotice(
        capture
          ? "Baseline saved. Later conversations won’t change this snapshot."
          : "Radar refreshed.",
      );
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }

  const observed = data ? Object.keys(data.readings).length : 0;
  return (
    <section
      aria-labelledby="ceo-radar-heading"
      className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4"
    >
      <header>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold tracking-[0.16em] text-teal-800 uppercase">
            Personal excellence
          </span>
          <button
            type="button"
            onClick={() => update(false)}
            aria-disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 aria-disabled:opacity-60 ${focusRing}`}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
          </button>
        </div>
        <h2
          id="ceo-radar-heading"
          ref={heading}
          tabIndex={-1}
          className="mt-1 text-xl font-bold tracking-tight text-slate-950 focus-visible:outline-2 focus-visible:outline-blue-700"
        >
          CEO knowledge baseline
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-700">
          Inferred from the topics in your CEO messages. This shows discussion coverage, not tested
          knowledge.
        </p>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
        >
          {error}
        </p>
      )}
      <p
        role="status"
        className={(busy && !data) || notice ? "text-xs font-medium text-teal-800" : "sr-only"}
      >
        {busy ? "Loading CEO radar…" : notice}
      </p>
      {data && (
        <>
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <strong className="text-slate-800">
                {data.capturedAt ? "Saved baseline" : "Unsaved preview"}
              </strong>
              {data.capturedAt && (
                <time dateTime={data.capturedAt} className="text-slate-600">
                  {new Date(data.capturedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              )}
            </div>
            <CeoTopicRadar readings={data.readings} />
            <p className="text-[11px] leading-relaxed text-slate-600">
              {data.personaVersion === null
                ? "Local persona rules"
                : `Persona v${data.personaVersion}`}{" "}
              · {data.ceoMessages} CEO {data.ceoMessages === 1 ? "message" : "messages"}. Stored
              demo conversations, if present, are included.
            </p>
            {!observed && (
              <p className="rounded-lg bg-white p-2.5 text-xs text-slate-700">
                No topic signals yet. Discuss one of the eight topics in the boardroom, then
                refresh.
              </p>
            )}
            {confirming && (
              <p
                id="replace-baseline-warning"
                className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950"
              >
                Replace the saved starting point with the latest persona signals? The previous
                snapshot will not be kept.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                ref={captureButton}
                type="button"
                onClick={() => update(true)}
                disabled={!observed}
                aria-disabled={busy || !observed}
                aria-describedby={confirming ? "replace-baseline-warning" : undefined}
                className={`inline-flex min-h-9 items-center gap-2 rounded-lg bg-teal-800 px-3 text-xs font-semibold text-white hover:bg-teal-900 aria-disabled:opacity-60 ${focusRing}`}
              >
                <Bookmark aria-hidden="true" className="h-3.5 w-3.5" />
                {confirming
                  ? "Confirm replacement"
                  : data.capturedAt
                    ? "Replace baseline…"
                    : "Capture baseline"}
              </button>
              {confirming && (
                <button
                  type="button"
                  className={`rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold ${focusRing}`}
                  onClick={() => {
                    setConfirming(false);
                    captureButton.current?.focus();
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 pb-2">
            <table className="w-full border-collapse text-left text-xs tabular-nums">
              <caption className="py-3 text-left text-sm font-bold text-slate-900">
                Topic readings
              </caption>
              <thead className="border-b border-slate-300 text-[11px] text-slate-600">
                <tr>
                  <th scope="col" className="pb-2">
                    Persona topic
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Score / 100
                  </th>
                  <th scope="col" className="pb-2 pl-3 text-right">
                    Signals
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {CEO_TOPICS.map((topic) => {
                  const reading = data.readings[topic.id];
                  return (
                    <tr key={topic.id}>
                      <th scope="row" className="py-2.5 pr-2 font-medium text-slate-800">
                        {topic.name}
                      </th>
                      <td
                        className={`whitespace-nowrap py-2.5 text-right ${reading ? "font-bold text-teal-800" : "text-slate-600"}`}
                      >
                        {reading?.score ?? "Unobserved"}
                      </td>
                      <td className="py-2.5 pl-3 text-right text-slate-600">
                        {reading?.signals ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-600">
            A signal is a matching topic keyword. More mentions can raise a score. A gap means there
            was no observed signal, not that you lack knowledge.
          </p>
        </>
      )}
    </section>
  );
}
