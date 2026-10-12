"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Octagon, ShieldCheck } from "lucide-react";
import { useDash } from "@/components/DashShell";
import { useStepUp } from "@/components/StepUp";
import { ErrorNote, PageTitle, errText } from "@/components/ui";
import { dash, type Row } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { when } from "@/lib/format";

/** Two-factor authentication, the security log, and the emergency stop. */
export default function SecurityPage() {
  const { overview, account, reload } = useDash();
  const { run } = useStepUp();
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Row[] | null>(null);

  const loadLog = useCallback(async () => {
    try {
      setLog((await dash.audit()).events);
    } catch (err) {
      setError(errText(err));
    }
  }, []);
  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  return (
    <>
      <PageTitle title="Security" />
      <TwoFactor enabled={overview.owner.two_factor} onChange={reload} />

      <section className="card mt-4 ring-1 ring-bad/30">
        <div className="flex items-center gap-2"><Octagon className="h-5 w-5 text-bad" /><span className="headline">Emergency stop</span></div>
        <p className="subhead mt-1">If a live key may have leaked: revoke every live key and pause money movement at once. Test keys keep working.</p>
        {account.frozen && account.frozen_by === "owner" ? (
          <button
            className="btn-tinted mt-4 !h-11"
            onClick={async () => {
              try {
                const r = await run((pin) => dash.resume(pin ?? ""), { needsPin: true });
                if (r) await reload();
              } catch (err) {
                setError(errText(err));
              }
            }}
          >
            Resume money movement
          </button>
        ) : account.frozen ? (
          <p className="notice-warn mt-4">CheqPay has paused this account. Email dev@mycheqpay.com.</p>
        ) : (
          <button
            className="btn mt-4 !h-11 !bg-bad"
            onClick={async () => {
              if (!window.confirm("Revoke all live keys and pause money movement now?")) return;
              try {
                await dash.emergencyStop();
                await reload();
                await loadLog();
              } catch (err) {
                setError(errText(err));
              }
            }}
          >
            Stop everything
          </button>
        )}
      </section>

      <ErrorNote error={error} />

      <h2 className="section-label mt-8 !px-0">Security log</h2>
      {!log ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-card shadow-card ring-1 ring-border/40">
          <table className="table">
            <thead><tr><th>What</th><th>Who</th><th>Target</th><th>IP</th><th>When</th></tr></thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-[13px]">{r.action}</td>
                  <td className="text-[14px]">{r.actor}</td>
                  <td className="font-mono text-[12px]">{r.target ?? "—"}</td>
                  <td className="font-mono text-[12px]">{r.ip ?? "—"}</td>
                  <td className="whitespace-nowrap text-[13px]">{when(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Set up an authenticator app (TOTP) on the CheqPay account, the same second factor the app uses. */
function TwoFactor({ enabled, onChange }: { enabled: boolean; onChange: () => Promise<void> }) {
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFactor, setHasFactor] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => setHasFactor(Boolean(data?.totp?.some((f) => f.status === "verified"))));
  }, [enabled]);

  async function start() {
    setBusy(true);
    setError(null);
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const stale of list?.all?.filter((f) => f.status !== "verified") ?? []) await supabase.auth.mfa.unenroll({ factorId: stale.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `CheqPay Developers ${Date.now()}` });
    setBusy(false);
    if (error || !data) return setError("Couldn't start set-up. Try again.");
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    setBusy(true);
    setError(null);
    const challenge = await supabase.auth.mfa.challenge({ factorId: enroll.factorId });
    if (challenge.error) {
      setBusy(false);
      return setError("Couldn't verify. Try again.");
    }
    const { error } = await supabase.auth.mfa.verify({ factorId: enroll.factorId, challengeId: challenge.data.id, code });
    setBusy(false);
    if (error) return setError("That code isn't right. Check the app and try again.");
    await supabase.auth.refreshSession();
    setEnroll(null);
    setHasFactor(true);
    await onChange();
  }

  return (
    <section className="card">
      <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-brand-light" /><span className="headline">Two-factor authentication</span></div>
      {hasFactor ? (
        <p className="subhead mt-1">
          On. Live changes ask for a code from your authenticator app.{enabled ? " This session is confirmed." : " You'll be asked for a code when you make one."}
        </p>
      ) : enroll ? (
        <form onSubmit={confirm} className="mt-3">
          <p className="subhead">Scan this with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="QR code for your authenticator app" width={180} height={180} className="mt-4 rounded-xl bg-white p-2" />
          <p className="footnote mt-2">Can&apos;t scan? Enter this key: <code className="font-mono">{enroll.secret}</code></p>
          <input inputMode="numeric" maxLength={6} className="input mt-4 !w-48 text-center font-mono text-[22px] tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="6-digit code" />
          <ErrorNote error={error} />
          <button disabled={busy || code.length !== 6} className="btn mt-4 !h-11">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Turn on"}</button>
        </form>
      ) : (
        <>
          <p className="subhead mt-1">Required before you go live, and for every live change: keys, webhooks, plans and money moves.</p>
          <ErrorNote error={error} />
          <button onClick={start} disabled={busy || hasFactor === null} className="btn mt-4 !h-11">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Set up an authenticator app"}</button>
        </>
      )}
    </section>
  );
}
