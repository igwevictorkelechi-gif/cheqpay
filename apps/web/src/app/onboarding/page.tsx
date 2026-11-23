"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { takeReturnTo } from "@/lib/returnTo";
import { Bitcoin, Loader2, Send, Users, Zap, type LucideIcon } from "lucide-react";
import { useFeatures } from "@/lib/useFeatures";
import { api, ApiError } from "@/services/api";

/** v2: a 3-segment, 3px progress bar — no labels, no dots. */
function Progress({ active }: { active: number }) {
  return (
    <div className="mb-6 flex gap-1.5" aria-label={`Step ${active + 1} of 3`}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`h-[3px] flex-1 rounded-full ${i <= active ? "bg-ink" : "bg-circle"}`} />
      ))}
    </div>
  );
}

type Goal = "send" | "bills" | "ajo" | "crypto";
const GOALS: { key: Goal; title: string; detail: string; Icon: LucideIcon; fg: string; bg: string; route: string }[] = [
  { key: "send", title: "Send money to people", detail: "Free and instant to CheqPay users", Icon: Send, fg: "#FF6B6B", bg: "rgba(255,107,107,0.15)", route: "/send" },
  { key: "bills", title: "Pay bills and airtime", detail: "Electricity, data, TV and more", Icon: Zap, fg: "#FBBF24", bg: "rgba(251,191,36,0.15)", route: "/pay-bill" },
  { key: "ajo", title: "Save with Ajo", detail: "On your own, or in a circle with friends", Icon: Users, fg: "#8A7BB5", bg: "rgba(107,91,149,0.2)", route: "/ajo" },
  { key: "crypto", title: "Buy and sell crypto", detail: "USDT, USDC and BTC, cashed out to naira", Icon: Bitcoin, fg: "#A78BFA", bg: "rgba(167,139,250,0.15)", route: "/crypto" },
];

/**
 * What verification unlocks, in plain terms — the real tier limits from
 * apps/api lib/kyc.ts (tier 1: ₦50,000 a payment, ₦100,000 a day out;
 * tier 2: ₦1,000,000 a payment). Keep in step with that file.
 */
const ASKS: { what: string; when: string; now?: boolean }[] = [
  { what: "Email and phone", when: "Now", now: true },
  { what: "BVN or ID", when: "To go above ₦50,000 a payment" },
  { what: "More checks", when: "Only above ₦1,000,000 a payment" },
];

function Field({
  label,
  value,
  onChange,
  placeholder,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <p className="mb-1 text-xs text-muted">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={numeric ? "numeric" : undefined}
        className="w-full bg-transparent text-base text-ink outline-none placeholder:text-muted"
      />
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const features = useFeatures();
  const [step, setStep] = useState<"goal" | "kyc" | "pin">("goal");
  const [goal, setGoal] = useState<Goal | null>(null);
  const goals = GOALS.filter(
    (g) =>
      (g.key !== "ajo" || features.ajo) &&
      (g.key !== "crypto" || features.crypto_trading) &&
      (g.key !== "bills" || features.bill_payments),
  );

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");

  const kycValid = firstName.trim().length >= 2 && lastName.trim().length >= 2;
  // Back to where sign-in started (e.g. "Continue with CheqPay" from the
  // Creators portal), or home.
  // Otherwise straight to the thing they said they came for.
  const finish = () => router.push(takeReturnTo() ?? GOALS.find((g) => g.key === goal)?.route ?? "/");

  const submitKyc = async () => {
    if (!kycValid) return;
    setSubmitting(true);
    setError(null);
    try {
      // Full KYC (BVN + government ID) happens on the Verify screen, which needs
      // document uploads. Here we only save the date of birth if given, so the
      // Verify screen can prefill it; the name is already on the auth profile.
      if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        await api.updateProfile({ dateOfBirth: dob });
      }
      setStep("pin");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const savePin = () => {
    if (pin.length < 4 || pin !== confirm) return;
    // Nothing is stored: a PIN kept in browser storage is readable by any
    // script on the page. App Lock (Settings) keeps only a hash, and money is
    // authorised by the server-side transaction PIN.
    finish();
  };

  return (
    <div className="flex min-h-screen justify-center bg-backdrop lg:bg-surface">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-8 lg:max-w-3xl">
        <Progress active={step === "goal" ? 0 : step === "kyc" ? 1 : 2} />

        {step === "goal" ? (
          <>
            <h1 className="mb-2 text-[24px] font-bold leading-[30px] tracking-[-0.02em] text-ink">
              What should CheqPay do for you first?
            </h1>
            <p className="mb-6 text-[15px] leading-[22px] text-muted">
              We&apos;ll take you straight there once you&apos;re set up.
            </p>

            <div role="radiogroup" className="overflow-hidden rounded-3xl border border-border bg-card">
              {goals.map((g, i) => {
                const on = goal === g.key;
                return (
                  <button
                    key={g.key}
                    role="radio"
                    aria-checked={on}
                    onClick={() => setGoal(g.key)}
                    className="flex w-full items-center gap-3 pl-4 text-left"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: g.bg }}>
                      <g.Icon className="h-5 w-5" style={{ color: g.fg }} strokeWidth={1.75} />
                    </span>
                    <span className={`flex min-w-0 flex-1 items-center gap-3 py-3.5 pr-4 ${i > 0 ? "border-t border-hairline" : ""}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-ink">{g.title}</span>
                        <span className="block text-[13px] text-muted">{g.detail}</span>
                      </span>
                      <span
                        className={`h-[22px] w-[22px] shrink-0 rounded-full border-2 ${on ? "border-brand" : "border-border"}`}
                        style={on ? { background: "radial-gradient(circle, #6B5B95 0 5px, transparent 6px)" } : undefined}
                      />
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mb-2.5 mt-6 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">What we&apos;ll ask for</p>
            <dl>
              {ASKS.map((a) => (
                <div key={a.what} className="flex min-h-[36px] items-center justify-between gap-4">
                  <dt className="text-[15px] text-ink">{a.what}</dt>
                  <dd className={a.now ? "rounded-full bg-brand/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-brand-light" : "text-right text-[13px] text-muted"}>
                    {a.when}
                  </dd>
                </div>
              ))}
            </dl>

            <button
              onClick={() => setStep("kyc")}
              disabled={!goal}
              className="mt-6 flex h-[54px] w-full items-center justify-center rounded-full bg-brand text-base font-bold text-white shadow-cta disabled:bg-card disabled:text-muted disabled:shadow-none"
            >
              Continue
            </button>
            <p className="mt-3 text-center text-[13px] text-muted">Takes about 2 minutes</p>
          </>
        ) : step === "kyc" ? (
          <>
            <h1 className="mb-2 text-[24px] font-bold leading-[30px] tracking-[-0.02em] text-ink">Tell us about you</h1>
            <p className="mb-6 text-base text-muted">
              Just your name to get started. You&apos;ll verify your identity with
              a BVN and a government ID from the Verify screen, which unlocks higher
              limits, deposits and crypto withdrawals.
            </p>

            <div className="space-y-3.5">
              <Field label="First name" value={firstName} onChange={setFirstName} placeholder="First name" />
              <Field label="Last name" value={lastName} onChange={setLastName} placeholder="Last name" />
              <Field label="Date of birth (optional)" value={dob} onChange={setDob} placeholder="YYYY-MM-DD" />
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <button
              onClick={submitKyc}
              disabled={!kycValid || submitting}
              className="mt-6 flex h-[54px] w-full items-center justify-center rounded-full bg-brand text-base font-bold text-white shadow-cta disabled:cursor-not-allowed disabled:bg-card disabled:text-muted disabled:shadow-none"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continue"}
            </button>
            <button onClick={() => setStep("pin")} className="w-full py-4 text-sm font-semibold text-muted">
              Skip for now
            </button>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-[24px] font-bold leading-[30px] tracking-[-0.02em] text-ink">Set up your PIN</h1>
            <p className="mb-6 text-base text-muted">
              Create a PIN to lock the app in this browser. You’ll enter it each time you open CheqPay.
            </p>

            <div className="space-y-3.5">
              <div className="rounded-2xl border border-border bg-card px-4 py-3">
                <p className="mb-1 text-xs text-muted">Enter a PIN (4–6 digits)</p>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full bg-transparent text-2xl tracking-[0.5em] text-ink outline-none"
                />
              </div>
              <div className="rounded-2xl border border-border bg-card px-4 py-3">
                <p className="mb-1 text-xs text-muted">Confirm PIN</p>
                <input
                  type="password"
                  inputMode="numeric"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full bg-transparent text-2xl tracking-[0.5em] text-ink outline-none"
                />
              </div>
            </div>

            {confirm.length > 0 && pin !== confirm && (
              <p className="mt-3 text-sm text-red-400">PINs don’t match.</p>
            )}

            <button
              onClick={savePin}
              disabled={pin.length < 4 || pin !== confirm}
              className="mt-6 h-[54px] w-full rounded-full bg-brand text-base font-bold text-white shadow-cta disabled:cursor-not-allowed disabled:bg-card disabled:text-muted disabled:shadow-none"
            >
              Finish setup
            </button>
            <button onClick={finish} className="w-full py-4 text-sm font-semibold text-muted">
              Skip for now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
