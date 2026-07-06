"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock, Unlock } from "lucide-react";
import { isAppLockEnabled, enableAppLock, disableAppLock } from "@/lib/applock";

export default function AppLockPage() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [settingPin, setSettingPin] = useState(false);
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(isAppLockEnabled());
  }, []);

  const save = () => {
    if (pin.length < 4) return setError("Use at least 4 digits.");
    if (pin !== confirm) return setError("PINs don’t match.");
    enableAppLock(pin);
    setPinValue("");
    setConfirm("");
    setSettingPin(false);
    setError(null);
    setEnabled(true);
  };

  const turnOff = () => {
    if (!window.confirm("Turn off app lock? Anyone with this device can open CheqPay.")) return;
    disableAppLock();
    setEnabled(false);
  };

  const pinInput = (value: string, onChange: (v: string) => void, label: string) => (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <p className="mb-1 text-xs text-muted">{label}</p>
      <input
        type="password"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          onChange(e.target.value.replace(/\D/g, "").slice(0, 6));
          setError(null);
        }}
        className="w-full bg-transparent text-2xl tracking-[0.5em] text-ink outline-none"
      />
    </div>
  );

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="mb-2 mt-6 text-4xl font-extrabold text-ink">App lock</h1>
        <p className="mb-6 text-base text-muted">
          Require a PIN each time you open CheqPay in this browser. (Face ID / biometrics are
          available in the mobile app.)
        </p>

        {settingPin ? (
          <div className="space-y-3.5">
            {pinInput(pin, setPinValue, "Enter a PIN (4–6 digits)")}
            {pinInput(confirm, setConfirm, "Confirm PIN")}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={save}
              className="w-full rounded-full bg-brand py-4 text-base font-bold text-white"
            >
              Save PIN
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center rounded-3xl bg-card p-5">
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                  enabled ? "bg-green-500/15" : "bg-circle"
                }`}
              >
                {enabled ? (
                  <Lock className="h-6 w-6 text-green-400" />
                ) : (
                  <Unlock className="h-6 w-6 text-muted" />
                )}
              </span>
              <div className="ml-4 flex-1">
                <p className="text-lg font-bold text-ink">App lock is {enabled ? "on" : "off"}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {enabled ? "PIN required to open the app" : "Set a PIN to enable"}
                </p>
              </div>
            </div>

            {enabled ? (
              <div className="mt-6 space-y-3">
                <button
                  onClick={() => setSettingPin(true)}
                  className="w-full rounded-full border border-border bg-card py-4 text-base font-bold text-ink"
                >
                  Change PIN
                </button>
                <button
                  onClick={turnOff}
                  className="w-full rounded-full border border-red-500 bg-card py-4 text-base font-bold text-red-500"
                >
                  Turn off app lock
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSettingPin(true)}
                className="mt-6 w-full rounded-full bg-brand py-4 text-base font-bold text-white"
              >
                Set up app lock
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
