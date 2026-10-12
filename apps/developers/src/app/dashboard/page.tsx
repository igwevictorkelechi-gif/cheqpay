"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { useDash } from "@/components/DashShell";
import { PageTitle, Status } from "@/components/ui";
import { money } from "@/lib/format";

const STEPS: { key: "test_key" | "two_factor" | "identity_verified" | "business_verified" | "plan" | "live_key"; label: string; href: string }[] = [
  { key: "test_key", label: "Create a test key", href: "/dashboard/keys/" },
  { key: "two_factor", label: "Turn on two-factor authentication", href: "/dashboard/security/" },
  { key: "identity_verified", label: "Verify your identity in the CheqPay app", href: "https://mycheqpay.com/kyc" },
  { key: "business_verified", label: "Verify your business", href: "/dashboard/go-live/" },
  { key: "plan", label: "Choose a plan", href: "/dashboard/billing/" },
  { key: "live_key", label: "Create a live key", href: "/dashboard/keys/" },
];

export default function OverviewPage() {
  const { overview, account, mode } = useDash();
  const wallets = overview.wallets?.[mode] ?? [];
  return (
    <>
      <PageTitle title={account.business_name} subtitle={<span className="flex items-center gap-2">Account status <Status value={account.status} /></span>} />

      {mode === "live" && overview.live_problem && <p className="notice-warn mb-5">{overview.live_problem.message}</p>}
      {account.status === "rejected" && account.review_note && <p className="notice-bad mb-5">Your business verification was declined: {account.review_note}</p>}

      <section>
        <h2 className="section-label !px-0">{mode === "test" ? "Sandbox main wallets" : "Live main wallets"}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {wallets.length ? (
            wallets.map((w) => (
              <div key={w.id} className="card">
                <div className="footnote">{w.currency} main wallet</div>
                <div className="mt-1 text-[30px] font-bold tracking-tight">{money(w.available_balance, w.currency)}</div>
                <code className="footnote font-mono">{w.id}</code>
              </div>
            ))
          ) : (
            <div className="card subhead">Your live wallets open when your business is verified.</div>
          )}
        </div>
        <p className="footnote mt-2">
          {mode === "test" ? (
            <>Top up simulated money on <Link className="link" href="/dashboard/sandbox/">Sandbox tools</Link>.</>
          ) : (
            <>Add money from, or move it back to, your CheqPay balance on <Link className="link" href="/dashboard/billing/">Plan &amp; billing</Link>.</>
          )}
        </p>
      </section>

      {overview.checklist && (
        <section className="mt-8">
          <h2 className="section-label !px-0">Getting to live</h2>
          <div className="group-list">
            {STEPS.map((s) => {
              const done = overview.checklist![s.key];
              return (
                <Link key={s.key} href={s.href} className="group-row hover:bg-circle/50">
                  {done ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-muted" />}
                  <span className={done ? "text-muted line-through" : ""}>{s.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {mode === "live" && overview.limits && (
        <section className="mt-8">
          <h2 className="section-label !px-0">Live limits{overview.limits.new_account ? " (first 30 days)" : ""}</h2>
          <div className="group-list">
            {(["NGN", "USD"] as const).map((c) => (
              <div key={c} className="group-row justify-between text-[15px]">
                <span className="text-muted">{c}</span>
                <span>Daily outflow {money(overview.limits!.daily_outflow[c], c)} · Single payment {money(overview.limits!.max_single_payment[c], c)} · Max balance {money(overview.limits!.max_balance[c], c)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
