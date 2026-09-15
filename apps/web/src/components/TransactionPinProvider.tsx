"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { ApiError, api } from "@/services/api";

/**
 * The transaction PIN prompt.
 *
 * This is NOT the App Lock PIN (components/LockGate, lib/applock). That one is
 * device-local and decides whether the app opens; this one is held by the
 * server and decides whether money moves. They are deliberately separate — a
 * stolen unlocked phone gets past the first and still cannot spend.
 *
 * Callers wrap a money action:
 *
 *   const { authorize } = useTransactionPin();
 *   await authorize((pin) => api.sendToUser(input, pin));
 *
 * The dialog owns the whole conversation with the server: it asks for the PIN,
 * runs the action, and when the server rejects the PIN it re-asks WITHOUT
 * unwinding the caller. That matters because a wrong PIN leaves the payment
 * entirely unmade (the server checks before its first write), so re-asking is
 * both safe and the only humane behaviour — the alternative is making someone
 * re-enter a whole transfer because they mistyped one digit.
 */

/** Run a money action with the PIN the user just typed. */
type PinAction<T> = (pin: string) => Promise<T>;

interface PinContextValue {
  /**
   * Prompt for the PIN, then run `action` with it. Resolves with the action's
   * result, or rejects with `PIN_CANCELLED` if the user dismissed the prompt.
   */
  authorize<T>(action: PinAction<T>, opts?: { title?: string; detail?: string }): Promise<T>;
}

export const PIN_CANCELLED = "pin_cancelled";

const PinContext = createContext<PinContextValue | null>(null);

export function useTransactionPin(): PinContextValue {
  const ctx = useContext(PinContext);
  if (!ctx) {
    throw new Error("useTransactionPin must be used inside <TransactionPinProvider>");
  }
  return ctx;
}

/** The error `code` the API returns, when it returns one. */
function codeOf(err: unknown): string | null {
  if (err instanceof ApiError) {
    const body = err.body as { code?: string } | null;
    return body?.code ?? null;
  }
  return null;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

type Mode = "closed" | "enter" | "create";

interface Pending {
  action: PinAction<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  title?: string;
  detail?: string;
}

export default function TransactionPinProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("closed");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<Pending | null>(null);

  const reset = useCallback(() => {
    setPin("");
    setConfirmPin("");
    setError(null);
    setBusy(false);
  }, []);

  const close = useCallback(() => {
    setMode("closed");
    reset();
  }, [reset]);

  /** Dismissing is a refusal to authorise, so the caller must hear about it. */
  const cancel = useCallback(() => {
    pending.current?.reject(new Error(PIN_CANCELLED));
    pending.current = null;
    close();
  }, [close]);

  const authorize = useCallback<PinContextValue["authorize"]>(
    (action, opts) =>
      new Promise((resolve, reject) => {
        pending.current = {
          action: action as PinAction<unknown>,
          resolve: resolve as (v: unknown) => void,
          reject,
          title: opts?.title,
          detail: opts?.detail,
        };
        reset();
        // Ask the server whether a PIN exists before deciding which screen to
        // show, so a first-timer is offered set-up instead of being asked for
        // a PIN they have never created.
        setMode("enter");
        void api
          .getTransactionPinStatus()
          .then((s) => {
            if (!pending.current) return; // cancelled while in flight
            if (!s.isSet) setMode("create");
            else if (s.locked) setError(lockedMessage(s.lockedUntil));
          })
          .catch(() => {
            /* Status is an optimisation. If it fails, the entry screen still
               works — the server has the final say on every attempt anyway. */
          });
      }),
    [reset],
  );

  /** Run the caller's action with this PIN, translating the server's verdict. */
  const submitEnter = async () => {
    const p = pending.current;
    if (!p || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const result = await p.action(pin);
      pending.current = null;
      p.resolve(result);
      close();
    } catch (err) {
      const code = codeOf(err);
      if (code === "pin_incorrect" || code === "pin_required") {
        // Wrong PIN: nothing was charged, so stay open and let them retry.
        setError(messageOf(err, "Incorrect PIN."));
        setPin("");
        setBusy(false);
        return;
      }
      if (code === "pin_locked") {
        setError(messageOf(err, "Your PIN is locked."));
        setPin("");
        setBusy(false);
        return;
      }
      if (code === "pin_not_set") {
        setMode("create");
        setPin("");
        setError(null);
        setBusy(false);
        return;
      }
      // Anything else is a real failure of the payment itself — the caller
      // owns how that is shown, so hand it back untouched.
      pending.current = null;
      p.reject(err);
      close();
    }
  };

  /** First-time set-up, then straight on to the payment they were making. */
  const submitCreate = async () => {
    if (pin.length < 4 || pin !== confirmPin) {
      setError(pin !== confirmPin ? "Those PINs don't match." : null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setTransactionPin(pin);
    } catch (err) {
      setError(messageOf(err, "That PIN can't be used. Please choose another."));
      setPin("");
      setConfirmPin("");
      setBusy(false);
      return;
    }
    // PIN created — continue with the action the user was actually trying to do.
    const p = pending.current;
    if (!p) {
      close();
      return;
    }
    try {
      const result = await p.action(pin);
      pending.current = null;
      p.resolve(result);
      close();
    } catch (err) {
      pending.current = null;
      p.reject(err);
      close();
    }
  };

  // Escape dismisses, like every other dialog in the app.
  useEffect(() => {
    if (mode === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, busy, cancel]);

  return (
    <PinContext.Provider value={{ authorize }}>
      {children}
      {mode !== "closed" && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pin-dialog-title"
        >
          <div className="w-full max-w-[420px] rounded-t-3xl bg-surface p-6 pb-8 sm:rounded-3xl">
            <div className="flex items-start justify-between">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card">
                <ShieldCheck className="h-6 w-6 text-brand" />
              </span>
              <button
                onClick={cancel}
                disabled={busy}
                aria-label="Cancel"
                className="rounded-full p-2 text-muted disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <h2 id="pin-dialog-title" className="mt-4 text-xl font-extrabold text-ink">
              {mode === "create"
                ? "Create your transaction PIN"
                : (pending.current?.title ?? "Enter your transaction PIN")}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {mode === "create"
                ? "You'll type this PIN to approve every payment. Keep it to yourself — anyone who knows it can spend from your account."
                : (pending.current?.detail ??
                  "This confirms the payment is really you.")}
            </p>

            <div className="mt-5 flex flex-col items-center gap-3">
              <PinField
                value={pin}
                onChange={(v) => {
                  setPin(v);
                  setError(null);
                }}
                autoFocus
                invalid={Boolean(error)}
                label={mode === "create" ? "New PIN" : "PIN"}
                onComplete={mode === "enter" ? submitEnter : undefined}
              />
              {mode === "create" && (
                <PinField
                  value={confirmPin}
                  onChange={(v) => {
                    setConfirmPin(v);
                    setError(null);
                  }}
                  invalid={Boolean(error)}
                  label="Confirm PIN"
                />
              )}
            </div>

            {error && (
              <p role="alert" className="mt-3 text-center text-sm text-red-400">
                {error}
              </p>
            )}

            <button
              onClick={mode === "create" ? submitCreate : submitEnter}
              disabled={busy || pin.length < 4 || (mode === "create" && confirmPin.length < 4)}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3.5 text-base font-bold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy
                ? "Confirming…"
                : mode === "create"
                  ? "Create PIN & continue"
                  : "Confirm payment"}
            </button>
          </div>
        </div>
      )}
    </PinContext.Provider>
  );
}

function lockedMessage(lockedUntil: string | null): string {
  if (!lockedUntil) return "Your PIN is locked after too many incorrect attempts.";
  const mins = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000));
  return `Your PIN is locked. Try again in about ${
    mins >= 60 ? `${Math.ceil(mins / 60)} hour(s)` : `${mins} minute(s)`
  }.`;
}

/**
 * One PIN entry. `type="password"` so shoulder-surfing and screen recordings
 * see nothing, `inputMode="numeric"` so phones raise the number pad, and
 * autoComplete off so browsers never offer to remember it.
 */
function PinField({
  value,
  onChange,
  label,
  autoFocus,
  invalid,
  onComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
  invalid?: boolean;
  onComplete?: () => void;
}) {
  return (
    <label className="flex w-full flex-col items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <input
        autoFocus={autoFocus}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        placeholder="••••"
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          onChange(v);
          if (v.length === 6) onComplete?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.length >= 4) onComplete?.();
        }}
        className={`w-[220px] rounded-2xl border bg-card py-3.5 text-center text-2xl tracking-[0.6em] text-ink outline-none ${
          invalid ? "border-red-500" : "border-border"
        }`}
      />
    </label>
  );
}
