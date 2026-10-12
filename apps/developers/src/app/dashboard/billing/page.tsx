"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";
import PlansTable from "@/components/PlansTable";
import { useDash } from "@/components/DashShell";
import { useStepUp } from "@/components/StepUp";
import { ErrorNote, PageTitle, Status, errText } from "@/components/ui";
import { dash, newIdempotencyKey, type Plan } from "@/lib/api";
import { money, when } from "@/lib/format";

/** Plan and billing, and moving live money between the CheqPay balance and the main wallets. */
export default function BillingPage() {
  const { overview, account, reload } = useDash();
  const { run } = useStepUp();
  const sub = overview.subscription;
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [move, setMove] = useState<{ direction: "in" | "out"; currency: "NGN" | "USD"; amount: string }>({ direction: "in", currency: "NGN", amount: "" });
  const [busy, setBusy] = useState(false);
  const live = overview.wallets?.live ?? [];

  const choose = async (p: Plan) => {
    if (!window.confirm(`Switch to ${p.name} (${money(p.price, "NGN")} a month)? Upgrades are charged now, pro rata, from your live main NGN wallet.`)) return;
    setError(null);
    try {
      const r = await run((pin) => dash.changePlan(p.id, pin ?? ""), { needsPin: true });
      if (!r) return;
      setDone(r.change.kind === "downgrade_scheduled" ? `You'll move to ${p.name} at the end of this period.` : `You're on ${p.name}.${r.change.charged ? ` ${money(r.change.charged, "NGN")} was charged.` : ""}`);
      await reload();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <>
      <PageTitle title="Plan & billing" />
      <section className="card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="headline">Current plan: {sub ? sub.plan_id : "Sandbox (free)"}</span>
          {sub && <Status value={sub.status} />}
        </div>
        {sub && (
          <p className="subhead mt-1">
            Renews {when(sub.current_period_end)} from your live main NGN wallet.
            {sub.cancel_at_period_end ? " It will end then." : sub.next_plan_id ? ` Moves to ${sub.next_plan_id} then.` : ""}
          </p>
        )}
        {sub && !sub.cancel_at_period_end && (
          <button
            className="link mt-3 text-[15px]"
            onClick={async () => {
              if (!window.confirm("Cancel at the end of this period? Live keys stop working then.")) return;
              try {
                await run(() => dash.cancelPlan());
                await reload();
              } catch (err) {
                setError(errText(err));
              }
            }}
          >
            Cancel plan
          </button>
        )}
      </section>
      <h2 className="section-label mt-8 !px-0">Plans</h2>
      {account.status !== "approved" && <p className="notice-warn mb-3">Paid plans need a verified business first (Go live).</p>}
      <PlansTable current={sub?.plan_id ?? "sandbox"} onChoose={account.status === "approved" ? choose : undefined} />

      <h2 className="section-label mt-10 !px-0">Live main wallets</h2>
      {live.length === 0 ? (
        <p className="subhead">Your live wallets open when your business is verified.</p>
      ) : (
        <div className="card">
          <p className="subhead">{live.map((w) => `${w.currency} ${money(w.available_balance, w.currency)}`).join(" · ")}</p>
          <p className="footnote mt-1">Move money between your CheqPay balance and your live main wallets. Money leaves CheqPay only through your own CheqPay balance.</p>
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              setDone(null);
              const key = newIdempotencyKey();
              try {
                const r = await run((pin) => dash.moveMoney(move, pin ?? "", key), { needsPin: true });
                if (r) {
                  setDone(`${move.direction === "in" ? "Added" : "Moved out"} ${money(r.transaction.amount, move.currency)}.`);
                  setMove({ ...move, amount: "" });
                  await reload();
                }
              } catch (err) {
                setError(errText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex gap-1 rounded-full bg-circle p-1">
              {(["in", "out"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setMove({ ...move, direction: d })} className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[14px] font-semibold ${move.direction === d ? "bg-card shadow-card" : "text-muted"}`}>
                  {d === "in" ? <><ArrowDownToLine className="h-4 w-4" /> Add money</> : <><ArrowUpFromLine className="h-4 w-4" /> Move out</>}
                </button>
              ))}
            </div>
            <select className="input !h-11 !w-28" value={move.currency} onChange={(e) => setMove({ ...move, currency: e.target.value as "NGN" | "USD" })}>
              <option>NGN</option>
              <option>USD</option>
            </select>
            <input className="input !h-11 !w-40" inputMode="decimal" placeholder="Amount" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value.replace(/[^\d.]/g, "") })} />
            <button disabled={busy || !move.amount} className="btn !h-11">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirm"}</button>
          </form>
        </div>
      )}
      {done && <p className="notice-good mt-4">{done}</p>}
      <ErrorNote error={error} />
    </>
  );
}
