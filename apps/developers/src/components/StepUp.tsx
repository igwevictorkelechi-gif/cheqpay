"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * Sensitive dashboard actions need more than a signed-in session:
 *   - live changes need the session confirmed with an authenticator app (2FA);
 *   - anything that moves money also needs the CheqPay transaction PIN.
 * `run` performs an action, and when the API asks for either step it shows a
 * small dialog, collects it, and retries. The PIN is held only for that retry.
 */

type Ask = { kind: "mfa" | "pin"; message?: string; resolve: (v: string | null) => void };

interface StepUpApi {
  /** Run `fn`; `pin` is passed when the action needs one (`needsPin`). */
  run<T>(fn: (pin?: string) => Promise<T>, opts?: { needsPin?: boolean }): Promise<T | null>;
}

const Ctx = createContext<StepUpApi | null>(null);

export function useStepUp(): StepUpApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStepUp outside StepUpProvider");
  return v;
}

async function verifyTotp(code: string): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return "Couldn't reach your sign-in. Try again.";
  const factor = data?.totp?.find((f) => f.status === "verified");
  if (!factor) return "no_factor";
  const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (challenge.error) return "Couldn't start the check. Try again.";
  const verify = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code });
  if (verify.error) return "That code isn't right. Check your authenticator app and try again.";
  await supabase.auth.refreshSession();
  return null;
}

export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noFactor, setNoFactor] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useCallback((kind: "mfa" | "pin", message?: string) => {
    setValue("");
    setError(message ?? null);
    setNoFactor(false);
    return new Promise<string | null>((resolve) => {
      setAsk({ kind, message, resolve });
      setTimeout(() => inputRef.current?.focus(), 50);
    });
  }, []);

  const run = useCallback<StepUpApi["run"]>(
    async (fn, opts = {}) => {
      let pin: string | undefined;
      if (opts.needsPin) {
        const p = await prompt("pin");
        if (!p) return null;
        pin = p;
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await fn(pin);
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          if (err.code === "mfa_required") {
            const ok = await prompt("mfa");
            if (!ok) return null;
            continue;
          }
          if (err.code === "pin_required" || err.code === "pin_incorrect") {
            const p = await prompt("pin", err.code === "pin_incorrect" ? err.message : undefined);
            if (!p) return null;
            pin = p;
            continue;
          }
          throw err;
        }
      }
      return null;
    },
    [prompt],
  );

  function close(v: string | null) {
    ask?.resolve(v);
    setAsk(null);
    setBusy(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ask) return;
    if (ask.kind === "pin") {
      if (!/^\d{4,6}$/.test(value)) return setError("Enter your 4 to 6 digit CheqPay PIN.");
      return close(value);
    }
    if (!/^\d{6}$/.test(value)) return setError("Enter the 6-digit code from your authenticator app.");
    setBusy(true);
    const problem = await verifyTotp(value);
    setBusy(false);
    if (problem === "no_factor") {
      setNoFactor(true);
      return;
    }
    if (problem) {
      setValue("");
      return setError(problem);
    }
    close("ok");
  }

  return (
    <Ctx.Provider value={{ run }}>
      {children}
      {ask && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true">
          <form onSubmit={submit} className="appear w-full max-w-sm rounded-3xl bg-card p-6 shadow-float">
            <div className="flex items-start justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/12 text-brand-light"><ShieldCheck className="h-6 w-6" /></span>
              <button type="button" onClick={() => close(null)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-circle" aria-label="Cancel">
                <X className="h-5 w-5" />
              </button>
            </div>
            {noFactor ? (
              <>
                <h2 className="headline mt-4">Turn on two-factor authentication</h2>
                <p className="subhead mt-1">Live changes need an authenticator app on your account. It takes a minute.</p>
                <Link href="/dashboard/security/" onClick={() => close(null)} className="btn mt-6 w-full">Set it up</Link>
              </>
            ) : (
              <>
                <h2 className="headline mt-4">{ask.kind === "pin" ? "Enter your transaction PIN" : "Confirm it's you"}</h2>
                <p className="subhead mt-1">
                  {ask.kind === "pin"
                    ? "The same PIN you use in the CheqPay app to send money."
                    : "Enter the 6-digit code from your authenticator app."}
                </p>
                <input
                  ref={inputRef}
                  type="password"
                  inputMode="numeric"
                  autoComplete={ask.kind === "pin" ? "off" : "one-time-code"}
                  maxLength={ask.kind === "pin" ? 6 : 6}
                  value={value}
                  onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
                  className="input mt-5 text-center font-mono text-[24px] tracking-[0.4em]"
                  aria-label={ask.kind === "pin" ? "Transaction PIN" : "Authenticator code"}
                />
                {error && <p className="notice-bad mt-3" role="alert">{error}</p>}
                <button type="submit" disabled={busy || !value} className="btn mt-5 w-full">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirm"}
                </button>
              </>
            )}
          </form>
        </div>
      )}
    </Ctx.Provider>
  );
}
