"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useDash } from "@/components/DashShell";
import { ErrorNote, PageTitle, errText } from "@/components/ui";
import { dash } from "@/lib/api";
import { money } from "@/lib/format";

/** Simulated money for test mode: top up the main wallets, or send a pretend bank transfer. */
export default function SandboxPage() {
  const { overview, reload } = useDash();
  const [currency, setCurrency] = useState<"NGN" | "USD">("NGN");
  const [amount, setAmount] = useState("100000");
  const [va, setVa] = useState("");
  const [depAmount, setDepAmount] = useState("5000");
  const [sender, setSender] = useState("");
  const [busy, setBusy] = useState<null | "topup" | "deposit">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const wallets = overview.wallets?.test ?? [];

  return (
    <>
      <PageTitle title="Sandbox tools" subtitle="Simulated money for test mode. Nothing here touches a real bank." />
      <div className="grid gap-4 md:grid-cols-2">
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy("topup");
            setError(null);
            setDone(null);
            try {
              const r = await dash.sandboxTopUp(currency, amount);
              setDone(`Your test ${currency} main wallet now holds ${money(r.wallet.available_balance, currency)}.`);
              await reload();
            } catch (err) {
              setError(errText(err));
            } finally {
              setBusy(null);
            }
          }}
        >
          <h2 className="headline">Top up a main wallet</h2>
          <p className="subhead mt-1">{wallets.map((w) => `${w.currency} ${money(w.available_balance, w.currency)}`).join(" · ")}</p>
          <div className="mt-4 flex gap-2">
            {(["NGN", "USD"] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCurrency(c)} className={`chip ${currency === c ? "chip-on" : ""}`}>{c}</button>
            ))}
          </div>
          <label className="label mt-4" htmlFor="ta">Amount ({currency === "NGN" ? "naira" : "dollars"})</label>
          <input id="ta" inputMode="decimal" className="input" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          <button disabled={busy !== null || !amount} className="btn mt-4 w-full">{busy === "topup" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Add test money"}</button>
        </form>

        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy("deposit");
            setError(null);
            setDone(null);
            try {
              const r = await dash.sandboxDeposit(va.trim(), depAmount, sender.trim() || undefined);
              setDone(`Deposit ${r.transaction.id} credited ${money(r.transaction.amount - (r.transaction.fee ?? 0), "NGN")} after fees.`);
            } catch (err) {
              setError(errText(err));
            } finally {
              setBusy(null);
            }
          }}
        >
          <h2 className="headline">Simulate a bank transfer</h2>
          <p className="subhead mt-1">Into a test virtual account: credited like a real deposit and sends deposit.received.</p>
          <label className="label mt-4" htmlFor="va">Virtual account id</label>
          <input id="va" className="input font-mono text-[15px]" placeholder="va_…" value={va} onChange={(e) => setVa(e.target.value)} />
          <label className="label mt-3" htmlFor="da">Amount (naira)</label>
          <input id="da" inputMode="decimal" className="input" value={depAmount} onChange={(e) => setDepAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          <label className="label mt-3" htmlFor="sn">Sender name (optional)</label>
          <input id="sn" className="input" value={sender} onChange={(e) => setSender(e.target.value)} maxLength={80} />
          <button disabled={busy !== null || !va.startsWith("va_") || !depAmount} className="btn mt-4 w-full">{busy === "deposit" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send test deposit"}</button>
        </form>
      </div>
      {done && <p className="notice-good mt-4">{done}</p>}
      <ErrorNote error={error} />
    </>
  );
}
