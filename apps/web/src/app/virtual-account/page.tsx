"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Landmark,
  Copy,
  Check,
  ShieldCheck,
  Info,
  Loader2,
} from "lucide-react";
import { api, ApiError, type VirtualAccount } from "@/services/api";
import { supabase } from "@/services/supabase";
import { useAuthStore } from "@/store";

export default function VirtualAccountPage() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<VirtualAccount | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Manual form is only a fallback (verified user but no name on file). Verified
  // users normally never see it — their account opens automatically.
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [bvn, setBvn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Amount the user chose on the previous (Add money) step, shown as a hint.
  const [amount, setAmount] = useState<number | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("amount");
    const n = raw ? Number(raw.replace(/\D/g, "")) : 0;
    if (n > 0) setAmount(n);
  }, []);

  useEffect(() => {
    // Prefill names from the profile.
    const parts = (user?.full_name ?? "").trim().split(/\s+/);
    if (parts[0]) setFirstName((v) => v || parts[0]);
    if (parts.length > 1) setLastName((v) => v || parts.slice(1).join(" "));
  }, [user?.full_name]);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const [{ virtualAccount }, me] = await Promise.all([
          api.getVirtualAccount(),
          api.getMe(),
        ]);

        // Already have an account → straight to the number, regardless of tier.
        if (virtualAccount) {
          setAccount(virtualAccount);
          setLoading(false);
          return;
        }

        // No account yet. Deposits require a verified identity.
        if (me.kycTier < 2) {
          // Not verified → send to KYC first, then come back here. Keep the
          // spinner up while we navigate (don't flash the fallback form).
          router.replace("/kyc?next=/virtual-account");
          return;
        }

        // Verified → open the Naira account automatically from the name on
        // file. No form, no re-verification.
        await autoOpen();
        setLoading(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setNeedsLogin(true);
        else setLoadError(true);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Open the user's NGN virtual account without asking anything, using the name
   * captured at sign-up. Falls back to the manual form only if we have no usable
   * name to send.
   */
  async function autoOpen(): Promise<void> {
    const { data } = await supabase.auth.getUser();
    const meta = (data.user?.user_metadata ?? {}) as { full_name?: string };
    const fullName = (user?.full_name || meta.full_name || "").trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "";
    const last = parts.length > 1 ? parts.slice(1).join(" ") : first;

    if (first.length < 2 || last.length < 2) {
      // No usable name on file — ask once (rare fallback).
      setShowForm(true);
      return;
    }

    const { virtualAccount } = await api.createVirtualAccount({
      firstName: first,
      lastName: last,
    });
    setAccount(virtualAccount);
  }

  const bvnValid = bvn === "" || /^\d{11}$/.test(bvn);
  const canSubmit =
    firstName.trim().length >= 2 && lastName.trim().length >= 2 && bvnValid && !submitting;

  async function submit() {
    setError(null);
    if (!/^\d{11}$/.test(bvn) && bvn !== "") {
      setError("BVN must be exactly 11 digits.");
      return;
    }
    setSubmitting(true);
    try {
      const { virtualAccount } = await api.createVirtualAccount({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        bvn: bvn.trim() || undefined,
      });
      setAccount(virtualAccount);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create your account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4">
        <button
          onClick={() => router.back()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted" />
          </div>
        ) : needsLogin ? (
          <p className="mt-10 text-center text-muted">Please sign in to set up your account.</p>
        ) : loadError ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <p className="text-muted">We couldn’t load your deposit account.</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-white active:scale-95"
            >
              Try again
            </button>
          </div>
        ) : account ? (
          // ---- Result: existing / newly-created account ----
          <>
            <div className="mt-6 flex flex-col items-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/20">
                <Landmark className="h-7 w-7 text-brand-light" />
              </span>
              <h1 className="mt-4 text-2xl font-extrabold text-ink">Your account is ready</h1>
              <p className="mt-1 text-sm text-muted">
                {amount
                  ? `Transfer ₦${amount.toLocaleString("en-NG")} to this account from any Nigerian bank to fund your wallet instantly.`
                  : "Send money to this account from any Nigerian bank to fund your wallet instantly."}
              </p>
            </div>

            {amount ? (
              <div className="mt-6 rounded-3xl bg-brand/10 p-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Amount to transfer
                </p>
                <p className="mt-1 text-3xl font-extrabold text-ink">
                  ₦{amount.toLocaleString("en-NG")}
                </p>
              </div>
            ) : null}

            <div className="mt-6 rounded-3xl bg-card p-5">
              <Field label="Bank name" value={account.bankName} />
              <div className="my-3 h-px bg-border" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Account number
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-2xl font-extrabold tracking-wide text-ink">
                    {account.accountNumber}
                  </span>
                  <button
                    onClick={() => copy(account.accountNumber)}
                    className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-sm font-bold text-ink active:scale-95"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <div className="my-3 h-px bg-border" />
              <Field
                label="Account type"
                value={account.permanent ? "Permanent (dedicated)" : "Temporary"}
              />
            </div>

            {!account.permanent && (
              <div className="mt-5 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <Info className="h-5 w-5 shrink-0 text-amber-400" />
                <p className="text-xs leading-relaxed text-amber-200/90">
                  This is a temporary account. Add your BVN to upgrade to a permanent, dedicated
                  account number you can reuse for every deposit.
                </p>
              </div>
            )}

            <button
              onClick={() => router.push("/")}
              className="mt-6 w-full rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
            >
              Done
            </button>
          </>
        ) : showForm ? (
          // ---- Fallback form (verified but no name on file) ----
          <>
            <h1 className="mt-6 text-3xl font-extrabold text-ink">Set up your account</h1>
            <p className="mt-2 text-sm text-muted">
              Create your own CheqPay account number to receive Naira deposits from any bank. We
              need a few details to open it.
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
                  Phone number <span className="font-normal">(optional)</span>
                </label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ""))}
                  inputMode="tel"
                  placeholder="0801 234 5678"
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-muted">
                  BVN <span className="font-normal">(optional — for a permanent account)</span>
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
                  With a BVN you get a permanent, dedicated account number. Without it, we open a
                  temporary one you can upgrade later.
                </p>
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <div className="mt-5 flex items-center gap-2 text-xs text-muted">
              <ShieldCheck className="h-4 w-4 text-brand-light" />
              Your details are sent securely to our licensed payment partner to open the account.
            </div>

            <button
              onClick={submit}
              disabled={!canSubmit}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99] disabled:opacity-40"
            >
              {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
              {submitting ? "Creating account…" : "Create my account"}
            </button>
          </>
        ) : (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted" />
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-base font-bold text-ink">{value}</p>
    </div>
  );
}
