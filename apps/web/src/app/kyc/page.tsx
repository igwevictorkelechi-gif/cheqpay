"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ShieldCheck, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/store";

type State = "loading" | "form" | "pending" | "approved";

export default function KYCPage() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [state, setState] = useState<State>("loading");
  const [tier, setTier] = useState(0);
  // Optional post-verification destination (e.g. the deposit flow sends the
  // user here to verify, then wants them back on the account page).
  const [nextUrl, setNextUrl] = useState<string | null>(null);

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    if (n && n.startsWith("/")) setNextUrl(n);
  }, []);

  const goNext = () => router.push(nextUrl || "/");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [bvn, setBvn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const parts = (user?.full_name ?? "").trim().split(/\s+/);
    if (parts[0]) setFirstName((v) => v || parts[0]);
    if (parts.length > 1) setLastName((v) => v || parts.slice(1).join(" "));
  }, [user?.full_name]);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { kycTier, records } = await api.getKyc();
        setTier(kycTier);
        if (kycTier >= 2) setState("approved");
        else if (records.some((r) => r.status === "PENDING")) setState("pending");
        else setState("form");
      } catch {
        setState("form");
      }
    })();
  }, []);

  const bvnValid = bvn === "" || /^\d{11}$/.test(bvn);
  const canSubmit =
    firstName.trim().length >= 2 && lastName.trim().length >= 2 && bvnValid && !submitting;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.submitKyc({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: dob || undefined,
        bvn: bvn.trim() || undefined,
      });
      setTier(res.tier);
      setState(res.autoVerified ? "approved" : "pending");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4">
        <button
          onClick={() => router.back()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {state === "loading" && (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted" />
          </div>
        )}

        {state === "approved" && (
          <div className="mt-10 flex flex-col items-center text-center">
            <CheckCircle2 className="h-20 w-20 text-green-400" />
            <h1 className="mt-6 text-2xl font-extrabold text-ink">You&apos;re verified</h1>
            <p className="mt-2 text-sm text-muted">
              Your identity is confirmed (Tier {tier}). Higher limits and crypto withdrawals are
              unlocked.
            </p>
            <button
              onClick={goNext}
              className="mt-8 w-full rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
            >
              {nextUrl ? "Continue to deposit" : "Done"}
            </button>
          </div>
        )}

        {state === "pending" && (
          <div className="mt-10 flex flex-col items-center text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/15">
              <Clock className="h-10 w-10 text-amber-400" />
            </span>
            <h1 className="mt-6 text-2xl font-extrabold text-ink">Under review</h1>
            <p className="mt-2 text-sm text-muted">
              We couldn&apos;t verify you automatically, so our team is reviewing your details.
              You&apos;ll be upgraded as soon as it&apos;s approved — usually within a few hours.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-8 w-full rounded-2xl bg-card py-4 font-bold text-ink active:scale-[0.99]"
            >
              Back home
            </button>
          </div>
        )}

        {state === "form" && (
          <>
            <div className="mt-6 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/20">
                <ShieldCheck className="h-6 w-6 text-brand-light" />
              </span>
              <h1 className="text-2xl font-extrabold text-ink">Verify your identity</h1>
            </div>
            <p className="mt-2 text-sm text-muted">
              Confirm your details to raise your limits and unlock crypto withdrawals. With a valid
              BVN you&apos;re verified instantly.
            </p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-muted">First name</label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-muted">Last name</label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-muted">
                  Date of birth <span className="font-normal">(optional)</span>
                </label>
                <input
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  type="date"
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-muted">
                  BVN <span className="font-normal">(for instant verification)</span>
                </label>
                <input
                  value={bvn}
                  onChange={(e) => setBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  inputMode="numeric"
                  placeholder="11-digit BVN"
                  className={`w-full rounded-2xl border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand ${
                    bvnValid ? "border-border" : "border-red-500/60"
                  }`}
                />
                <p className="mt-1.5 text-xs text-muted">
                  Without a BVN we&apos;ll review your submission manually.
                </p>
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <button
              onClick={submit}
              disabled={!canSubmit}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99] disabled:opacity-40"
            >
              {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
              {submitting ? "Verifying…" : "Submit for verification"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
