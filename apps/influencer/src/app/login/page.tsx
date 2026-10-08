"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import Logo from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { safeNext, startCheqPaySignIn } from "@/lib/cheqpaySignIn";

type Step = "start" | "code" | "password";

/**
 * Sign in with a CheqPay account, three ways, simplest first:
 *   1. Continue with CheqPay — sign in (or sign up) on mycheqpay.com and come
 *      straight back;
 *   2. an emailed 6-digit code, exactly like the CheqPay app;
 *   3. a password, for the few who set one.
 * Only existing CheqPay accounts can sign in here; new people are sent to
 * create one on CheqPay first.
 */
export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "cheqpay" | "send" | "verify" | "password">(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const next = () => safeNext(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next"));

  // Already signed in: straight on.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => data.session && router.replace(next()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const cleanEmail = email.trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);

  async function continueWithCheqPay(target?: string) {
    setBusy("cheqpay");
    setError(null);
    try {
      await startCheqPaySignIn(target ?? next());
    } catch {
      setBusy(null);
      setError("Couldn't open CheqPay. Please try again.");
    }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!emailOk) return setError("Enter the email on your CheqPay account.");
    setBusy("send");
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: cleanEmail, options: { shouldCreateUser: false } });
    setBusy(null);
    if (error) {
      if (/signups? not allowed|not found|user/i.test(error.message)) {
        return setError("No CheqPay account uses this email. Create one below, then come back.");
      }
      if (/rate|seconds/i.test(error.message)) return setError("Please wait a minute before asking for another code.");
      return setError("We couldn't send a code right now. Please try again.");
    }
    setStep("code");
    setCode("");
    setCooldown(60);
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (code.length !== 6) return;
    setBusy("verify");
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: cleanEmail, token: code, type: "email" });
    setBusy(null);
    if (error) {
      setCode("");
      return setError("That code isn't right or has expired. Check your email or send a new one.");
    }
    router.replace(next());
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    setBusy(null);
    if (error) {
      return setError(error.message === "Invalid login credentials" ? "That email and password don't match a CheqPay account." : error.message);
    }
    router.replace(next());
  }

  // Auto-submit once six digits are in (typed or pasted).
  useEffect(() => {
    if (step === "code" && code.length === 6 && !busy) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col px-5 pb-10">
      <header className="py-5"><Logo /></header>

      <main className="my-auto">
        {step === "start" && (
          <div className="appear">
            <h1 className="title-lg">Sign in</h1>
            <p className="subhead mt-2">Use your CheqPay account. Your creator earnings are paid into it.</p>

            <button onClick={() => continueWithCheqPay()} disabled={busy !== null} className="btn mt-8 w-full">
              {busy === "cheqpay" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon.png" alt="" width={22} height={22} className="rounded-[6px]" />
                  Continue with CheqPay
                </>
              )}
            </button>

            <div className="my-7 flex items-center gap-3 text-[13px] text-muted">
              <span className="h-px flex-1 bg-border" /> or use your email <span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={sendCode} noValidate>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {error && <p className="notice-bad mt-4" role="alert">{error}</p>}
              <button type="submit" disabled={busy !== null || !email} className="btn-tinted mt-4 w-full">
                {busy === "send" ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Mail className="h-5 w-5" /> Email me a code</>}
              </button>
            </form>

            <div className="mt-8 space-y-3 text-center text-[15px]">
              <p className="text-muted">
                New to CheqPay?{" "}
                <button onClick={() => continueWithCheqPay("/apply")} className="link">Create an account</button>
              </p>
              <button onClick={() => { setError(null); setStep("password"); }} className="footnote hover:text-ink">
                Use a password instead
              </button>
            </div>
          </div>
        )}

        {step === "code" && (
          <form onSubmit={verify} className="appear">
            <button type="button" onClick={() => { setStep("start"); setError(null); }} className="btn-ghost -ml-4 !h-10 !px-4 text-[15px]">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <h1 className="title-lg mt-4">Check your email</h1>
            <p className="subhead mt-2">
              We sent a 6-digit code to <span className="font-semibold text-ink">{cleanEmail}</span>.
            </p>
            <input
              ref={codeRef}
              aria-label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="input mt-8 !h-16 text-center font-mono text-[28px] tracking-[0.5em]"
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            {error && <p className="notice-bad mt-4" role="alert">{error}</p>}
            <button type="submit" disabled={busy !== null || code.length !== 6} className="btn mt-6 w-full">
              {busy === "verify" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}
            </button>
            <div className="mt-6 text-center text-[15px]">
              {cooldown > 0 ? (
                <span className="text-muted">Send a new code in {cooldown}s</span>
              ) : (
                <button type="button" onClick={() => sendCode()} className="link">Send a new code</button>
              )}
            </div>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={signInWithPassword} className="appear">
            <button type="button" onClick={() => { setStep("start"); setError(null); }} className="btn-ghost -ml-4 !h-10 !px-4 text-[15px]">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <h1 className="title-lg mt-4">Sign in with a password</h1>
            <div className="mt-8 space-y-4">
              <div>
                <label className="label" htmlFor="pw-email">Email</label>
                <input id="pw-email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            {error && <p className="notice-bad mt-4" role="alert">{error}</p>}
            <button type="submit" disabled={busy !== null || !emailOk || !password} className="btn mt-6 w-full">
              {busy === "password" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}
            </button>
            <p className="footnote mt-6 text-center">
              No password? <button type="button" onClick={() => setStep("start")} className="link">Get a code by email instead</button>
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
