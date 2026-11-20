"use client";

import { useId, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

/**
 * The Phase 0 sign-in ritual: one access code, no user directory yet.
 * Phase 2 replaces the code with OIDC/SAML and leaves this route's contract intact.
 */
export default function SignInForm({
  destination,
  initialError,
}: {
  destination: string;
  initialError: string | null;
}) {
  const codeId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Sign-in failed. Try again.");
        setAccessCode("");
        setBusy(false);
        input.current?.focus();
        return;
      }
      // Full navigation, not router.push: the console is server-rendered with the new cookie.
      window.location.assign(destination);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <section
      aria-labelledby="signin-heading"
      className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
    >
      <div className="flex items-center gap-2 text-teal-300">
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        <span className="text-[10px] font-bold tracking-[0.16em] uppercase">Aether</span>
      </div>
      <h1 id="signin-heading" className="mt-2 text-xl font-bold tracking-tight text-white">
        Sign in to the executive suite
      </h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        This console holds board transcripts and restricted enterprise documents. A signed
        session is required for every request.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
        <div>
          <label htmlFor={codeId} className="block text-xs font-semibold text-slate-300">
            Access code
          </label>
          <input
            ref={input}
            id={codeId}
            name="accessCode"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus-visible:border-teal-400 focus-visible:ring-2 focus-visible:ring-teal-400/40"
          />
        </div>

        {error ? (
          <p
            id={errorId}
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || accessCode.trim().length === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        Single-operator installation. Sessions expire after 8 hours; sign out on shared machines.
      </p>
    </section>
  );
}
