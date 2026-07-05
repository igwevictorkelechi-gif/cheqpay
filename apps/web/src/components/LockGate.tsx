"use client";

import { useEffect, useState } from "react";
import { Lock, Fingerprint } from "lucide-react";
import { isAppLockEnabled, verifyPin } from "@/lib/applock";
import { supabase } from "@/services/supabase";

/**
 * PIN lock overlay for the web PWA. Engages only when the user has a session
 * AND an app-lock PIN set. Re-locks when the tab regains focus.
 */
export default function LockGate() {
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const maybeLock = async () => {
    if (!isAppLockEnabled()) return;
    const { data } = await supabase.auth.getSession();
    if (data.session) setLocked(true);
  };

  useEffect(() => {
    maybeLock();
    const onFocus = () => maybeLock();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") maybeLock();
    });
    return () => window.removeEventListener("focus", onFocus);
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

      <span className="mt-5 flex items-center gap-2 text-muted">
        <Fingerprint className="h-5 w-5" />
        <span className="text-sm">Biometrics available in the mobile app</span>
      </span>
    </div>
  );
}
