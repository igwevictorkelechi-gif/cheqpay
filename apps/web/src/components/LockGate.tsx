"use client";

import { useEffect, useState } from "react";
import { Lock, Fingerprint, Loader2 } from "lucide-react";
import { enableAppLock, isAppLockEnabled, verifyPin } from "@/lib/applock";
import { supabase } from "@/services/supabase";

/**
 * Lock screen steps. "otp"/"newPin" make up the forgot-PIN recovery: the PIN
 * lives only on this device, so the only way to prove ownership is a fresh
 * one-time code to the account's email address.
 */
type Step = "pin" | "otp" | "newPin";

// Only re-lock after the app has been in the background for at least this long.
// Quick tab switches (copying an address, checking another app for a code)
// should NOT force a PIN re-entry — that was the old, spammy behaviour.
const RELOCK_AFTER_MS = 60_000;

/**
 * PIN lock overlay for the web PWA. Engages only when the user has a session
 * AND has explicitly turned on App Lock. It locks once on a fresh open, and
 * again only after the app has been backgrounded past RELOCK_AFTER_MS — not on
 * every window focus.
 */
export default function LockGate() {
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  // Forgot-PIN recovery
  const [step, setStep] = useState<Step>("pin");
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const lockNow = async () => {
    if (!isAppLockEnabled()) return;
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      setEmail(data.session.user.email ?? null);
      setLocked(true);
    }
  };

  const resetRecovery = () => {
    setStep("pin");
    setCode("");
    setNewPin("");
    setConfirmPin("");
    setMsg(null);
  };

  /** Email a one-time code to the address on the account. */
  const sendCode = async () => {
    if (!email) {
      setMsg("Your account has no email address. Please contact support.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      setStep("otp");
      setMsg(`We sent a 6-digit code to ${email}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn’t send the code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /** Verify the code, which proves ownership of the account email. */
  const verifyCode = async () => {
    if (!email) return;
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw error;
      setStep("newPin");
      setMsg(null);
    } catch {
      setMsg("That code isn’t right or has expired. Request a new one.");
    } finally {
      setBusy(false);
    }
  };

  /** Replace the device PIN and let the user straight back in. */
  const saveNewPin = () => {
    if (newPin.length < 4) return setMsg("Use at least 4 digits.");
    if (newPin !== confirmPin) return setMsg("PINs don’t match.");
    enableAppLock(newPin);
    setLocked(false);
    setPin("");
    resetRecovery();
  };

  useEffect(() => {
    // Lock once when the app first loads with an active session.
    lockNow();

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      // Became visible again — only re-lock if we were away long enough.
      if (hiddenAt !== null && Date.now() - hiddenAt >= RELOCK_AFTER_MS) {
        lockNow();
      }
      hiddenAt = null;
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const submit = (value: string) => {
    if (verifyPin(value)) {
      setLocked(false);
      setPin("");
      setError(false);
    } else {
      setError(true);
      setPin("");
    }
  };

  if (!locked) return null;

  const codeInput = (
    value: string,
    onChange: (v: string) => void,
    opts?: { autoFocus?: boolean; masked?: boolean }
  ) => (
    <input
      autoFocus={opts?.autoFocus}
      type={opts?.masked ? "password" : "text"}
      inputMode="numeric"
      value={value}
      onChange={(e) => {
        onChange(e.target.value.replace(/\D/g, "").slice(0, 6));
        setMsg(null);
      }}
      className="w-[200px] rounded-2xl border border-border bg-card py-3.5 text-center text-2xl tracking-[0.5em] text-ink outline-none focus:border-brand"
    />
  );

  // ---- Forgot-PIN recovery ----
  if (step !== "pin") {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface px-8">
        <span className="flex h-[72px] w-[72px] items-center justify-center rounded-3xl bg-card">
          <Lock className="h-9 w-9 text-brand" />
        </span>
        <h1 className="mt-5 text-center text-2xl font-extrabold text-ink">
          {step === "otp" ? "Check your email" : "Set a new PIN"}
        </h1>
        <p className="mb-6 mt-2 max-w-[300px] text-center text-sm text-muted">
          {step === "otp"
            ? `Enter the 6-digit code we sent to ${email ?? "your email"}.`
            : "Choose a new 4–6 digit PIN for this device."}
        </p>

        {step === "otp" ? (
          <>
            {codeInput(code, setCode, { autoFocus: true })}
            {msg && <p className="mt-3 max-w-[300px] text-center text-sm text-muted">{msg}</p>}
            <button
              onClick={verifyCode}
              disabled={code.length < 6 || busy}
              className="mt-6 flex items-center gap-2 rounded-full bg-brand px-12 py-3.5 text-base font-bold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              onClick={sendCode}
              disabled={busy}
              className="mt-4 text-sm font-semibold text-brand-light disabled:opacity-50"
            >
              Send a new code
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              {codeInput(newPin, setNewPin, { autoFocus: true, masked: true })}
              {codeInput(confirmPin, setConfirmPin, { masked: true })}
            </div>
            {msg && <p className="mt-3 text-sm text-red-400">{msg}</p>}
            <button
              onClick={saveNewPin}
              disabled={newPin.length < 4 || confirmPin.length < 4}
              className="mt-6 rounded-full bg-brand px-12 py-3.5 text-base font-bold text-white disabled:opacity-50"
            >
              Save PIN &amp; unlock
            </button>
          </>
        )}

        <button onClick={resetRecovery} className="mt-5 text-sm font-semibold text-muted">
          Back to PIN
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface px-8">
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-3xl bg-card">
        <Lock className="h-9 w-9 text-brand" />
      </span>
      <h1 className="mt-5 text-2xl font-extrabold text-ink">CheqPay is locked</h1>
      <p className="mb-6 mt-2 text-sm text-muted">Enter your PIN to continue</p>

      <input
        autoFocus
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          setPin(v);
          setError(false);
          if (v.length === 6) submit(v);
        }}
        className={`w-[200px] rounded-2xl border bg-card py-3.5 text-center text-2xl tracking-[0.75em] text-ink outline-none ${
          error ? "border-red-500" : "border-border"
        }`}
      />
      {error && <p className="mt-2.5 text-sm text-red-400">Wrong PIN. Try again.</p>}

      <button
        onClick={() => submit(pin)}
        disabled={pin.length < 4}
        className="mt-6 rounded-full px-12 py-3.5 text-base font-bold text-white disabled:cursor-not-allowed"
        style={{ backgroundColor: pin.length >= 4 ? "#6B5B95" : "#2C2738" }}
      >
        Unlock
      </button>

      <button
        onClick={sendCode}
        disabled={busy}
        className="mt-5 flex items-center gap-2 text-sm font-semibold text-brand-light disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? "Sending code…" : "Forgot PIN?"}
      </button>
      {msg && step === "pin" && (
        <p className="mt-2 max-w-[300px] text-center text-sm text-muted">{msg}</p>
      )}

      <span className="mt-5 flex items-center gap-2 text-muted">
        <Fingerprint className="h-5 w-5" />
        <span className="text-sm">Biometrics available in the mobile app</span>
      </span>
    </div>
  );
}
