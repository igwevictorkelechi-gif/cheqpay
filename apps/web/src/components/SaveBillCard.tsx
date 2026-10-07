"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api, ApiError } from "@/services/api";

const IDEAS: Record<string, string[]> = {
  airtime: ["My line", "Mum's line", "Dad's line"],
  data: ["My data", "Home router"],
  electricity: ["Home meter", "Shop meter"],
  cabletv: ["Living room TV", "Bedroom TV"],
  betting: ["My wallet"],
};

/** After a successful bill: keep it in "Pay bills" under the user's own name. */
export default function SaveBillCard(props: { service: string; billerId: string; customer: string; planId?: string | null; amount?: string | null; className?: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveBill({ service: props.service, billerId: props.billerId, customer: props.customer, nickname: name.trim(), planId: props.planId ?? null, amount: props.amount ?? null });
      setSaved(name.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <p className={`flex items-center justify-center gap-2 rounded-2xl bg-green-500/10 px-4 py-3 text-sm font-semibold text-green-400 ${props.className ?? ""}`}>
        <Check className="h-4 w-4" /> Saved as &ldquo;{saved}&rdquo; in Pay bills
      </p>
    );
  }
  return (
    <div className={`rounded-3xl bg-card p-4 text-left ${props.className ?? ""}`}>
      <p className="font-bold text-ink">Save this bill?</p>
      <p className="mb-3 text-xs text-muted">Pay it again in one tap, see when it&apos;s due, or switch on autopay.</p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder="Name it, e.g. Mum's line"
          className="min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-ink placeholder-muted outline-none focus:border-brand"
        />
        <button onClick={save} disabled={busy || !name.trim()} className="rounded-2xl bg-brand px-5 text-sm font-bold text-white disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {(IDEAS[props.service] ?? []).map((n) => (
          <button key={n} onClick={() => setName(n)} className="rounded-full bg-circle px-3 py-1.5 text-xs font-semibold text-ink">
            {n}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
