"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ShieldCheck, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/store";
import DesktopSidebar from "@/components/DesktopSidebar";

type State = "loading" | "form" | "pending" | "approved";

const ID_TYPES: { value: "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE"; label: string }[] = [
  { value: "NIN", label: "NIN" },
  { value: "PASSPORT", label: "International passport" },
  { value: "VOTERS_CARD", label: "Voter's card" },
  { value: "DRIVERS_LICENSE", label: "Driver's licence" },
];

/**
 * Draw the image onto a canvas capped at 1600px on its long edge and return
 * JPEG base64 (no data: prefix). Keeps uploads small and uniform.
 */
async function downscaleToBase64(
  file: File
): Promise<{ base64: string; contentType: "image/jpeg" }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load the image"));
    el.src = dataUrl;
  });
  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: out.split(",")[1] ?? "", contentType: "image/jpeg" };
}

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
  // Government ID (required). Type + number are typed; the two refs come back
  // from uploading the front/back images to the API.
  const [idType, setIdType] = useState<
    "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE" | ""
  >("");
  const [idNumber, setIdNumber] = useState("");
  const [frontRef, setFrontRef] = useState<string | null>(null);
  const [backRef, setBackRef] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"front" | "back" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
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
  const dobRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const parts = (user?.full_name ?? "").trim().split(/\s+/);
    if (parts[0]) setFirstName((v) => v || parts[0]);
    if (parts.length > 1) setLastName((v) => v || parts.slice(1).join(" "));
  }, [user?.full_name]);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { kycTier, records, providerEnrolled, legalName, dateOfBirth } =
          await api.getKyc();
        if (dateOfBirth) setDob(dateOfBirth);
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
  // Date of birth is mandatory: the full Maplerad enrolment requires it. A
  // plausible date, in the past, roughly within a human lifespan.
  const dobValid = /^\d{4}-\d{2}-\d{2}$/.test(dob) && (() => {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return false;
    const year = d.getUTCFullYear();
    return d.getTime() < Date.now() && year >= 1900;
  })();

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

  // Government ID is required: a type, a number, and both images uploaded.
  const idComplete = Boolean(idType && idNumber.trim().length >= 4 && frontRef && backRef);

  const canSubmit =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    dobValid &&
    idComplete &&
    bvnValid &&
    phoneValid &&
    // When the ONLY reason the user is here is the missing details, letting
    // them submit without those details would repeat the exact failure that
    // sent them here.
    (!needsDetails || (phone.trim() !== "" && addressComplete)) &&
    !submitting;

  /**
   * Downscale a picked image to a data URL under ~1600px, then hand its base64
   * (no data: prefix) to the API. Downscaling keeps the request small enough for
   * the serverless body limit and strips most EXIF bloat.
   */
  async function uploadSide(side: "front" | "back", file: File) {
    setUploadError(null);
    setUploading(side);
    try {
      const { base64, contentType } = await downscaleToBase64(file);
      const { ref } = await api.uploadKycDocument(base64, side, contentType);
      if (side === "front") setFrontRef(ref);
      else setBackRef(ref);
    } catch (e) {
      setUploadError(
        e instanceof ApiError ? e.message : "Could not upload the image. Please try again."
      );
      if (side === "front") setFrontRef(null);
      else setBackRef(null);
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.submitKyc({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: dob,
        bvn: bvn.trim() || undefined,
        identity: {
          type: idType as "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE",
          number: idNumber.trim(),
          frontRef: frontRef as string,
          backRef: backRef as string,
        },
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
    <div className="flex min-h-screen justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4 lg:max-w-3xl">
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
                  Date of birth{" "}
                  <span className="font-normal text-muted">
                    — required to open your account number
                  </span>
                </label>
                <input
                  ref={dobRef}
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  type="date"
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  // Browsers open the calendar only from the small icon at the
                  // right edge, which is an easy target to miss on a phone.
                  // Clicking anywhere in the field opens it. showPicker throws
                  // if the browser blocks it outside a user gesture — this IS a
                  // gesture, but older engines lack the method entirely.
                  onClick={() => {
                    try {
                      dobRef.current?.showPicker?.();
                    } catch {
                      /* fall back to the native icon */
                    }
                  }}
                  className={`w-full cursor-pointer rounded-2xl border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand ${
                    dob === "" || dobValid ? "border-border" : "border-red-500/60"
                  }`}
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

              {/* Government ID — required. Pick a type, enter its number, and
                  upload clear photos of the front and back. */}
              <div className="!mt-7 rounded-2xl border border-border bg-card/50 p-4">
                <p className="text-sm font-semibold text-ink">Government ID</p>
                <p className="mt-1 text-xs text-muted">
                  Required. Choose an ID type, enter its number, and upload clear
                  photos of the front and back.
                </p>

                <div className="mt-4">
                  <label className="mb-1.5 block text-sm font-semibold text-muted">ID type</label>
                  <select
                    value={idType}
                    onChange={(e) => setIdType(e.target.value as typeof idType)}
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink outline-none focus:border-brand"
                  >
                    <option value="">Select an ID type</option>
                    {ID_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3">
                  <label className="mb-1.5 block text-sm font-semibold text-muted">ID number</label>
                  <input
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value.slice(0, 30))}
                    placeholder="Document number"
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  {(["front", "back"] as const).map((side) => {
                    const ref = side === "front" ? frontRef : backRef;
                    const busy = uploading === side;
                    return (
                      <label
                        key={side}
                        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border px-3 py-5 text-center text-xs ${
                          ref ? "border-green-500/60 text-ink" : "border-border text-muted"
                        }`}
                      >
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={busy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadSide(side, f);
                          }}
                        />
                        {busy ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : ref ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        ) : (
                          <ShieldCheck className="h-5 w-5" />
                        )}
                        <span className="font-semibold capitalize">
                          {ref ? `${side} uploaded` : `Upload ${side}`}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {uploadError && (
                  <p className="mt-2 text-xs text-red-500">{uploadError}</p>
                )}
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
