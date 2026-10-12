"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { useDash } from "@/components/DashShell";
import { useStepUp } from "@/components/StepUp";
import { ErrorNote, PageTitle, Status, errText } from "@/components/ui";
import { APP_URL, dash } from "@/lib/api";
import { when } from "@/lib/format";

const TYPES = [
  ["limited_company", "Limited company (RC)"],
  ["business_name", "Business name (BN)"],
  ["incorporated_trustees", "Incorporated trustees (IT)"],
  ["partnership", "Partnership"],
] as const;

const VOLUMES = [
  ["under_1m", "Under ₦1m a month"],
  ["1m_10m", "₦1m to ₦10m"],
  ["10m_50m", "₦10m to ₦50m"],
  ["50m_200m", "₦50m to ₦200m"],
  ["over_200m", "Over ₦200m"],
] as const;

const MAX_BYTES = 3 * 1024 * 1024;

/** Business verification (KYB): the application for live access. */
export default function GoLivePage() {
  const { account, overview, reload } = useDash();
  const { run } = useStepUp();
  const [f, setF] = useState({ legal_name: "", rc_number: "", business_type: "limited_company", website: "https://", use_case: "", expected_monthly_volume: "under_1m", contact_phone: "", address: "" });
  const [doc, setDoc] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  if (account.status === "pending_review" || account.status === "approved" || account.status === "suspended") {
    return (
      <>
        <PageTitle title="Go live" />
        <div className="card">
          <div className="flex items-center gap-2"><span className="headline">Business verification</span><Status value={account.status} /></div>
          <p className="subhead mt-2">
            {account.status === "pending_review"
              ? `Submitted ${when(account.submitted_at)}. We usually answer within two working days, by email.`
              : account.status === "approved"
                ? `Verified. Live since ${when(account.live_since)}. Choose a plan and create a live key to start.`
                : `This account is suspended${account.suspended_reason ? `: ${account.suspended_reason}` : ""}. Email dev@mycheqpay.com.`}
          </p>
        </div>
      </>
    );
  }

  const identityOk = overview.owner.kyc_tier >= 1;
  return (
    <>
      <PageTitle title="Go live" subtitle="Tell us about your business. Live access is for verified businesses only." />
      {account.status === "rejected" && account.review_note && <p className="notice-bad mb-5">Your last application was declined: {account.review_note} Correct it and apply again.</p>}
      {!identityOk && (
        <p className="notice-warn mb-5">
          First verify your own identity in the CheqPay app (<a className="link" href={`${APP_URL}/kyc`}>open it</a>). The person behind a business is verified before the business.
        </p>
      )}
      <form
        className="card max-w-2xl space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!doc) return setError("Attach your CAC certificate.");
          setBusy(true);
          setError(null);
          try {
            const r = await run(() => dash.apply({ ...f, cac_document: doc.dataUrl }));
            if (r) await reload();
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <label className="label" htmlFor="ln">Registered business name</label>
          <input id="ln" className="input" value={f.legal_name} onChange={set("legal_name")} maxLength={120} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="rc">CAC registration number</label>
            <input id="rc" className="input" placeholder="RC1234567" value={f.rc_number} onChange={set("rc_number")} />
          </div>
          <div>
            <label className="label" htmlFor="bt">Type</label>
            <select id="bt" className="input" value={f.business_type} onChange={set("business_type")}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ws">Website</label>
          <input id="ws" className="input" value={f.website} onChange={set("website")} />
        </div>
        <div>
          <label className="label" htmlFor="uc">What will you build with CheqPay?</label>
          <textarea id="uc" className="input" value={f.use_case} onChange={set("use_case")} maxLength={1500} placeholder="Who your customers are, what they'll use wallets, bills or cards for, and how money flows." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="vol">Expected monthly volume</label>
            <select id="vol" className="input" value={f.expected_monthly_volume} onChange={set("expected_monthly_volume")}>
              {VOLUMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ph">Contact phone</label>
            <input id="ph" className="input" inputMode="tel" placeholder="0803 123 4567" value={f.contact_phone} onChange={set("contact_phone")} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ad">Business address</label>
          <input id="ad" className="input" value={f.address} onChange={set("address")} maxLength={300} />
        </div>
        <div>
          <span className="label">CAC certificate (PDF, JPG or PNG, up to 3 MB)</span>
          <label className="btn-tinted !h-11 cursor-pointer">
            {doc ? <><CheckCircle2 className="h-5 w-5" /> {doc.name}</> : <><Upload className="h-5 w-5" /> Choose file</>}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > MAX_BYTES) return setError("That file is over 3 MB.");
                const reader = new FileReader();
                reader.onload = () => setDoc({ name: file.name, dataUrl: String(reader.result) });
                reader.readAsDataURL(file);
              }}
            />
          </label>
        </div>
        <ErrorNote error={error} />
        <button disabled={busy || !identityOk} className="btn w-full sm:w-auto">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit for review"}</button>
        <p className="footnote">Submitting asks you to confirm with your authenticator app.</p>
      </form>
    </>
  );
}
