"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, ShieldCheck } from "lucide-react";
import DesktopSidebar from "@/components/DesktopSidebar";
import { api, ApiError } from "@/services/api";

/**
 * Manage the transaction PIN — the one that authorises payments.
 *
 * Distinct from /app-lock, which is the device-local PIN that decides whether
 * the app opens at all. The copy here leans on that difference because the two
 * are genuinely easy to confuse, and confusing them leads people to assume
 * they are protected when they are not.
 */
export default function TransactionPinPage() {
  const router = useRouter();
  const [status, setStatus] = useState<{ isSet: boolean; locked: boolean } | null>(null);
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api
      .getTransactionPinStatus()
      .then((s) => setStatus({ isSet: s.isSet, locked: s.locked }))
      .catch(() => setStatus({ isSet: false, locked: false }));
  }, []);

  const creating = status?.isSet === false;

  async function save() {
    setError(null);
    if (pin !== confirmPin) {
      setError("Those PINs don't match.");
      return;
    }
    setBusy(true);
    try {
      if (creating) await api.setTransactionPin(pin);
      else await api.changeTransactionPin(currentPin, pin);
      setSaved(true);
      setCurrentPin("");
      setPin("");
      setConfirmPin("");
      setStatus({ isSet: true, locked: false });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save that PIN. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    pin.length >= 4 && confirmPin.length >= 4 && (creating || currentPin.length >= 4) && !busy;

  return (
    <div className="flex min-h-screen justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-8 pt-3 lg:max-w-3xl">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <span className="mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-card">
          <ShieldCheck className="h-7 w-7 text-brand" />
        </span>
        <h1 className="mt-4 text-3xl font-extrabold text-ink">Transaction PIN</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          You type this PIN to approve every payment — sending money, withdrawing,
          paying a bill or moving money on and off your card. It is separate from
          your App lock PIN, which only decides whether the app opens on this device.
        </p>

        {status === null ? (
          <Loader2 className="mt-8 h-5 w-5 animate-spin text-muted" />
        ) : (
          <div className="mt-6 space-y-3">
            {!creating && (
              <Field
                label="Current PIN"
                value={currentPin}
                onChange={(v) => {
                  setCurrentPin(v);
                  setError(null);
                  setSaved(false);
                }}
              />
            )}
            <Field
              label={creating ? "Choose a PIN" : "New PIN"}
              value={pin}
              onChange={(v) => {
                setPin(v);
                setError(null);
                setSaved(false);
              }}
            />
            <Field
              label="Confirm PIN"
              value={confirmPin}
              onChange={(v) => {
                setConfirmPin(v);
                setError(null);
                setSaved(false);
              }}
            />

            <p className="pt-1 text-xs leading-relaxed text-muted">
              4 to 6 digits. Avoid repeated digits, runs like 1234, and anything
              someone could guess from your birthday — five wrong tries locks
              payments for a while.
            </p>

            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            {saved && (
              <p className="flex items-center gap-1.5 text-sm text-emerald-400">
                <Check className="h-4 w-4" /> PIN saved.
              </p>
            )}

            <button
              onClick={save}
              disabled={!canSave}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3.5 text-base font-bold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {creating ? "Create PIN" : "Change PIN"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-muted">{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        placeholder="••••"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-center text-xl tracking-[0.5em] text-ink outline-none focus:border-brand"
      />
    </label>
  );
}
