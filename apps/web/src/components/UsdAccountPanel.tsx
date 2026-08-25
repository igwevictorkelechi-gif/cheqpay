"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, DollarSign, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { api, ApiError, type UsdAccount, type UsdAccountStatus } from "@/services/api";

const EMPLOYMENT = [
  { value: "EMPLOYED", label: "Employed" },
  { value: "SELF_EMPLOYED", label: "Self-employed" },
  { value: "STUDENT", label: "Student" },
  { value: "UNEMPLOYED", label: "Unemployed" },
  { value: "RETIRED", label: "Retired" },
];

const RESIDENCY = [
  { value: "NON_RESIDENT_ALIEN", label: "Non-resident alien" },
  { value: "RESIDENT_ALIEN", label: "Resident alien" },
  { value: "US_CITIZEN", label: "US citizen" },
];

/**
 * The USD account, behind a switch. Kept self-contained so the NGN flow on the
 * page is untouched: it loads its own state and only talks to /virtual-accounts/usd.
 *
 * A USD account needs US-banking KYC the NGN one never asked for (a tax/ID
 * number, employment, residency), and it can require the holder to consent to US
 * banking terms before it activates — surfaced here as a link rather than hidden.
 */
export default function UsdAccountPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<UsdAccount | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<UsdAccountStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Form state.
  const [idNumber, setIdNumber] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("EMPLOYED");
  const [employmentDescription, setEmploymentDescription] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [residency, setResidency] = useState("NON_RESIDENT_ALIEN");
  const [submitting, setSubmitting] = useState(false);

  const loadOnce = useCallback(async () => {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const [{ usdAccount }, { balances }] = await Promise.all([
        api.getUsdAccount(),
        api.getBalances().catch(() => ({ balances: [] })),
      ]);
      setAccount(usdAccount);
      setBalance(balances.find((b) => b.asset === "USD")?.availableFormatted ?? "0.00");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your USD account.");
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [loaded, loading]);

  useEffect(() => {
    if (open) void loadOnce();
  }, [open, loadOnce]);

  const canSubmit =
    idNumber.trim().length >= 3 &&
    employmentDescription.trim().length >= 2 &&
    employerName.trim().length >= 1 &&
    !submitting;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const { usdAccount } = await api.createUsdAccount({
        identificationNumber: idNumber.trim(),
        employmentStatus,
        employmentDescription: employmentDescription.trim(),
        nationality: "NG",
        employerName: employerName.trim(),
        usResidencyStatus: residency,
      });
      setAccount(usdAccount);
    } catch (e) {
      const notEnrolled =
        e instanceof ApiError &&
        (e.status === 409 ||
          (typeof e.body === "object" &&
            e.body !== null &&
            (e.body as { code?: string }).code === "not_enrolled"));
      if (notEnrolled) {
        setError("Finish identity verification first, then open your USD account.");
      } else {
        setError(e instanceof ApiError ? e.message : "Could not open your USD account. Please try again.");
      }
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

  async function checkStatus() {
    setStatusError(null);
    setCheckingStatus(true);
    try {
      const { usdStatus } = await api.getUsdAccountStatus();
      if (usdStatus) setStatus(usdStatus);
      else setStatusError("Status is not available for this account yet.");
    } catch (e) {
      setStatusError(e instanceof ApiError ? e.message : "Could not check the status.");
    } finally {
      setCheckingStatus(false);
    }
  }

  // A green pill for APPROVED, amber for anything still in review.
  const statusTone = (s: string) =>
    /approv|active|success/i.test(s)
      ? "bg-green-500/15 text-green-600"
      : /declin|reject|fail/i.test(s)
        ? "bg-red-500/15 text-red-500"
        : "bg-amber-500/15 text-amber-600";

  return (
    <div className="mt-6 rounded-3xl bg-card p-5">
      {/* The switch. */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-green-500/15">
            <DollarSign className="h-5 w-5 text-green-500" />
          </span>
          <div>
            <p className="text-sm font-bold text-ink">USD account</p>
            <p className="text-xs text-muted">Receive US dollars into your wallet</p>
          </div>
        </div>
        <button
          role="switch"
          aria-checked={open}
          onClick={() => setOpen((v) => !v)}
          className={`relative h-7 w-12 rounded-full transition-colors ${
            open ? "bg-brand" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
              open ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {open && (
        <div className="mt-5 border-t border-border pt-5">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : account ? (
            <>
              <div className="mb-4 rounded-2xl bg-green-500/10 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  USD balance
                </p>
                <p className="mt-0.5 text-2xl font-extrabold text-ink">
                  ${balance ?? "0.00"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Bank name</p>
                <p className="mt-1 text-sm font-semibold text-ink">{account.bankName}</p>
              </div>
              <div className="my-3 h-px bg-border" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Account number</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-2xl font-extrabold tracking-wide text-ink">
                  {account.accountNumber}
                </span>
                <button
                  onClick={() => copy(account.accountNumber)}
                  className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-sm font-bold text-ink active:scale-95"
                >
                  {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              {account.accountName && (
                <p className="mt-2 text-sm text-muted">Account name: {account.accountName}</p>
              )}
              {account.consentRequired && account.consentUrl && (
                <a
                  href={account.consentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center justify-center gap-2 rounded-full bg-amber-500/15 px-4 py-3 text-sm font-bold text-amber-600"
                >
                  Consent required — finish activation
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              {account.status && !account.consentRequired && (
                <p className="mt-3 text-xs text-muted">Status: {account.status}</p>
              )}

              {/* Application status — Maplerad reviews the KYC before approval. */}
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Application status
                  </p>
                  <button
                    onClick={checkStatus}
                    disabled={checkingStatus}
                    className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-bold text-ink active:scale-95 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${checkingStatus ? "animate-spin" : ""}`} />
                    {checkingStatus ? "Checking…" : "Check status"}
                  </button>
                </div>
                {status && (
                  <div className="mt-3">
                    <span
                      className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${statusTone(status.status)}`}
                    >
                      {status.status}
                    </span>
                    {status.messages.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {status.messages.map((m, i) => (
                          <li key={i} className="text-sm text-muted">
                            • {m}
                          </li>
                        ))}
                      </ul>
                    )}
                    {status.kycLink && (
                      <a
                        href={status.kycLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand/10 px-4 py-2 text-sm font-bold text-brand"
                      >
                        Complete verification
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                )}
                {statusError && <p className="mt-2 text-xs text-red-400">{statusError}</p>}
              </div>
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted">
                A USD account needs a few extra details for US banking compliance. This is separate
                from your Naira account.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Tax / ID number
                  </label>
                  <input
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    placeholder="Your tax identification number"
                    className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-ink placeholder-muted outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Employment status
                  </label>
                  <select
                    value={employmentStatus}
                    onChange={(e) => setEmploymentStatus(e.target.value)}
                    className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-ink outline-none focus:border-brand"
                  >
                    {EMPLOYMENT.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    What do you do?
                  </label>
                  <input
                    value={employmentDescription}
                    onChange={(e) => setEmploymentDescription(e.target.value)}
                    placeholder="e.g. Software engineering"
                    className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-ink placeholder-muted outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Employer / business name
                  </label>
                  <input
                    value={employerName}
                    onChange={(e) => setEmployerName(e.target.value)}
                    placeholder="e.g. Self / company name"
                    className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-ink placeholder-muted outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    US residency status
                  </label>
                  <select
                    value={residency}
                    onChange={(e) => setResidency(e.target.value)}
                    className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-ink outline-none focus:border-brand"
                  >
                    {RESIDENCY.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="mt-5 w-full rounded-full bg-brand py-3.5 text-sm font-bold text-white active:scale-95 disabled:opacity-50"
              >
                {submitting ? "Opening…" : "Open USD account"}
              </button>
            </>
          )}

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
