"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { dash, type Plan } from "@/lib/api";
import { bps, money } from "@/lib/format";

const fee = (f: { bps: number; cap: number }) => (f.bps ? `${bps(f.bps)}${f.cap ? `, max ${money(f.cap, "NGN")}` : ""}` : "—");

/** The plans, read live: prices are set by CheqPay and can change. */
export default function PlansTable({ current, onChoose }: { current?: string | null; onChoose?: (p: Plan) => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    dash.plans().then((r) => setPlans(r.plans)).catch(() => setFailed(true));
  }, []);
  if (failed) return <p className="notice-warn mt-6">Plans will be published here at launch. Questions? Email dev@mycheqpay.com.</p>;
  if (!plans) return <div className="mt-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  const rows: [string, (p: Plan) => string][] = [
    ["Live keys", (p) => (p.live ? "Yes" : "Test only")],
    ["Requests per minute, per key", (p) => p.rate_limit_per_minute.toLocaleString("en-US")],
    ["Bill payment fee", (p) => fee(p.bill_fee)],
    ["Deposit fee", (p) => fee(p.deposit_fee)],
    ["Card price", (p) => (p.card_issue_fee_usd_cents ? money(p.card_issue_fee_usd_cents, "USD") : "—")],
    ["Card top-up fee", (p) => (p.card_funding_fee_bps ? bps(p.card_funding_fee_bps) : "—")],
    ["Customers", (p) => p.max_customers.toLocaleString("en-US")],
    ["Virtual accounts", (p) => p.max_virtual_accounts.toLocaleString("en-US")],
    ["Active cards", (p) => p.max_active_cards.toLocaleString("en-US")],
    ["Webhook endpoints per mode", (p) => String(p.webhook_endpoints)],
  ];
  return (
    <div className="mt-6 overflow-x-auto rounded-3xl bg-card shadow-card ring-1 ring-border/40">
      <table className="table min-w-[640px]">
        <thead>
          <tr>
            <th />
            {plans.map((p) => (
              <th key={p.id} className="!normal-case">
                <div className="text-[17px] font-bold text-ink">{p.name}</div>
                <div className="mt-0.5 text-[15px] font-semibold text-brand-light">{p.price ? `${money(p.price, "NGN")}/mo` : "Free"}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}>
              <td className="text-muted">{label}</td>
              {plans.map((p) => <td key={p.id}>{f(p)}</td>)}
            </tr>
          ))}
          {onChoose && (
            <tr>
              <td />
              {plans.map((p) => (
                <td key={p.id}>
                  {p.id === current ? (
                    <span className="pill bg-good/15 text-good">Current</span>
                  ) : p.live ? (
                    <button onClick={() => onChoose(p)} className="btn-tinted !h-9 !px-4 text-[14px]">Choose</button>
                  ) : null}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
