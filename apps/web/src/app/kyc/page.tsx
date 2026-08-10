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
  // Required to enroll the user with Maplerad, which is what a deposit account
  // and a crypto address both hang off. The form used to omit them, so
  // enrollment was skipped for every user who ever verified — they passed KYC
  // and still got no account number.
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Already verified, but missing the details the provider needs. */
  const [needsDetails, setNeedsDetails] = useState(false);

  useEffect(() => {
    const parts = (user?.full_name ?? "").trim().split(/\s+/);
    if (parts[0]) setFirstName((v) => v || parts[0]);
    if (parts.length > 1) setLastName((v) => v || parts.slice(1).join(" "));
  }, [user?.full_name]);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { kycTier, records, providerEnrolled, legalName } = await api.getKyc();
        setTier(kycTier);
        // Prefer the name we verified over the Supabase profile name: it is
        // the one the provider will check against the BVN, and it is the only
        // one guaranteed to be present.
        if (legalName) {
          const parts = legalName.trim().split(/\s+/);
          if (parts[0]) setFirstName(parts[0]);
          if (parts.length > 1) setLastName(parts.slice(1).join(" "));
        }
        // Verified but not enrolled means the account is only half open — no
        // deposit account, no crypto wallet — because the details the provider
        // needs were never collected. Show the form rather than a green tick
        // over an account that cannot receive money.
        if (kycTier >= 2 && providerEnrolled === false) {
          setNeedsDetails(true);
          setState("form");
        } else if (kycTier >= 2) setState("approved");
        else if (records.some((r) => r.status === "PENDING")) setState("pending");
        else setState("form");
      } catch {
        setState("form");
      }
    })();
  }, []);

  const bvnValid = bvn === "" || /^\d{11}$/.test(bvn);
  // Accepts 08031234567, +2348031234567 and 2348031234567 — the server
  // normalizes to Maplerad's +234 / subscriber split.
  const phoneValid = phone === "" || /^(\+?234|0)?\d{10}$/.test(phone.replace(/[\s-]/g, ""));

  /**
   * Everything Maplerad needs to enroll a customer. Sent only when complete —
   * a partial address is rejected by the API's schema, which would fail the
   * whole KYC submission rather than just skipping enrollment.
   */
  const addressComplete =
    street.trim().length >= 3 &&
    city.trim().length >= 2 &&
    addrState.trim().length >= 2 &&
    postalCode.trim().length >= 3;

  const canSubmit =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    bvnValid &&
    phoneValid &&
    // When the ONLY reason the user is here is the missing details, letting
    // them submit without those details would repeat the exact failure that
    // sent them here.
    (!needsDetails || (phone.trim() !== "" && addressComplete)) &&
    !submitting;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.submitKyc({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: dob || undefined,
        bvn: bvn.trim() || undefined,
        phone: phone.trim() || undefined,
        address: addressComplete
          ? {
              street: street.trim(),
              city: city.trim(),
              state: addrState.trim(),
              postalCode: postalCode.trim(),
            }
          : undefined,
      });
      setTier(res.tier);
      // An already-verified user completing their details won't retype the
      // BVN, so this submission reports autoVerified:false. Sending them to
      // "Under review" would tell a verified user their account is in doubt.
      setState(needsDetails || res.autoVerified ? "approved" : "pending");
      setNeedsDetails(false);
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
              <h1 className="text-2xl font-extrabold text-ink">
                {needsDetails ? "Finish setting up your account" : "Verify your identity"}
              </h1>
            </div>
            <p className="mt-2 text-sm text-muted">
              {needsDetails
                ? "You're verified — we just need a couple more details to open your Naira account number and your crypto wallet."
                : "Confirm your details to raise your limits and unlock crypto withdrawals. With a valid BVN you're verified instantly."}
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

              {/* Contact and address. Separated with a heading because the user
                  is being asked for noticeably more than a name — saying what
                  it buys them is what makes it worth filling in. */}
              <div className="!mt-7 rounded-2xl border border-border bg-card/50 p-4">
                <p className="text-sm font-semibold text-ink">
                  Contact &amp; address
                </p>
                <p className="mt-1 text-xs text-muted">
                  {needsDetails
                    ? "This is all that's missing. Your BVN is already on file — you don't need to enter it again."
                    : "Needed to open your dedicated Naira account number and your crypto wallet. You can skip these, but those two stay locked until you add them."}
                </p>

                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-muted">
                      Phone number
                    </label>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      placeholder="080 1234 5678"
                      className={`w-full rounded-2xl border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand ${
                        phoneValid ? "border-border" : "border-red-500/60"
                      }`}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-muted">
                      Street address
                    </label>
                    <input
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      placeholder="12 Adeola Odeku Street"
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-muted">
                        City
                      </label>
                      <input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="Lagos"
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-muted">
                        State
                      </label>
                      <input
                        value={addrState}
                        onChange={(e) => setAddrState(e.target.value)}
                        placeholder="Lagos"
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-muted">
                      Postal code
                    </label>
                    <input
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      inputMode="numeric"
                      placeholder="101241"
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                    />
                  </div>
                </div>
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <button
              onClick={submit}
              disabled={!canSubmit}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99] disabled:opacity-40"
            >
              {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
              {submitting
                ? needsDetails
                  ? "Saving…"
                  : "Verifying…"
                : needsDetails
                  ? "Finish setup"
                  : "Submit for verification"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
