"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/services/api";
import { setUserPin } from "@/lib/applock";

const STEPS = ["Account", "Email", "Identity", "PIN"];

function Progress({ active }: { active: number }) {
  return (
    <div className="mb-8 flex items-center gap-2">
      {STEPS.map((label, i) => {
        const on = i <= active;
        return (
          <div key={label} className="flex-1 text-center">
            <div
              className="h-1 w-full rounded-full"
              style={{ backgroundColor: on ? "#6B5B95" : "#2C2738" }}
            />
            <p
              className={`mt-2 text-xs ${on ? "text-ink" : "text-muted"} ${
                i === active ? "font-bold" : "font-medium"
              }`}
            >
              {label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

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
  const [step, setStep] = useState<"kyc" | "pin">("kyc");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [bvn, setBvn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");

  const kycValid = firstName.trim().length >= 2 && lastName.trim().length >= 2;
  const finish = () => router.push("/");

  const submitKyc = async () => {
    if (!kycValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submitKyc({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : undefined,
        bvn: bvn.trim() || undefined,
      });
      setStep("pin");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const savePin = () => {
    if (pin.length < 4 || pin !== confirm) return;
    // Store the user's security PIN. This does NOT enable App Lock — that's an
    // opt-in from Settings → App Lock.
    setUserPin(pin);
    finish();
  };

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-8">
        <Progress active={step === "kyc" ? 2 : 3} />

        {step === "kyc" ? (
          <>
            <h1 className="mb-2 text-3xl font-extrabold text-ink">Verify your identity</h1>
            <p className="mb-6 text-base text-muted">
              A quick check unlocks higher limits and crypto withdrawals. Your BVN name is matched
              automatically.
            </p>

            <div className="space-y-3.5">
              <Field label="First name" value={firstName} onChange={setFirstName} placeholder="First name" />
              <Field label="Last name" value={lastName} onChange={setLastName} placeholder="Last name" />
              <Field label="Date of birth (optional)" value={dob} onChange={setDob} placeholder="YYYY-MM-DD" />
              <Field
                label="BVN (optional)"
                value={bvn}
                onChange={(t) => setBvn(t.replace(/\D/g, "").slice(0, 11))}
                placeholder="11-digit BVN"
                numeric
              />
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <button
              onClick={submitKyc}
              disabled={!kycValid || submitting}
              className="mt-6 flex w-full items-center justify-center rounded-full py-4 text-base font-bold text-white disabled:cursor-not-allowed"
              style={{ backgroundColor: kycValid && !submitting ? "#6B5B95" : "#2C2738" }}
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continue"}
            </button>
            <button onClick={() => setStep("pin")} className="w-full py-4 text-sm font-semibold text-muted">
              Skip for now
            </button>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-3xl font-extrabold text-ink">Set up your PIN</h1>
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
              className="mt-6 w-full rounded-full py-4 text-base font-bold text-white disabled:cursor-not-allowed"
              style={{ backgroundColor: pin.length >= 4 && pin === confirm ? "#6B5B95" : "#2C2738" }}
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
