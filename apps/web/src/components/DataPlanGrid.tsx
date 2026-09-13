"use client";

import { useMemo, useState } from "react";
import type { BillCashback, BillPlan } from "@/services/api";

/**
 * The data-bundle picker.
 *
 * A provider returns bundles in its own storage order, which buries the good
 * deals — so the API ranks them by naira-per-gigabyte and flags the strongest
 * ones. This renders that ranking: "Best deals" leads with the best plan from
 * each duration (not just the cheapest per GB, which would be five monthly
 * bundles and nothing for someone who needs data today), and the duration tabs
 * let a customer who knows what they want go straight there.
 *
 * Every number shown is real: the price is the provider's live price and the
 * cashback is computed from the same rate the award path pays.
 */

type Bucket = NonNullable<BillPlan["bucket"]>;

const TAB_LABELS: { key: Bucket | "hot"; label: string }[] = [
  { key: "hot", label: "Best deals" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "extended", label: "Extended" },
  { key: "other", label: "Other" },
];

/** What this plan actually earns back, using the live rate. Null when off. */
function cashbackNaira(amount: string, cb?: BillCashback): number | null {
  if (!cb?.enabled || cb.billBps <= 0) return null;
  const naira = Number(amount);
  if (!Number.isFinite(naira) || naira <= 0) return null;
  let reward = (naira * cb.billBps) / 10_000;
  if (cb.maxNgn > 0) reward = Math.min(reward, cb.maxNgn);
  if (reward <= 0) return null;
  // Match the ledger: kobo precision, floored, never rounded up.
  return Math.floor(reward * 100) / 100;
}

function money(n: number): string {
  return n.toLocaleString("en-NG", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export default function DataPlanGrid({
  plans,
  selectedId,
  onSelect,
  cashback,
}: {
  plans: BillPlan[];
  selectedId: string;
  onSelect: (id: string) => void;
  cashback?: BillCashback;
}) {
  // Only offer tabs that actually hold something, so there are no dead tabs.
  const tabs = useMemo(() => {
    const present = new Set(plans.map((p) => p.bucket ?? "other"));
    return TAB_LABELS.filter(
      (t) => (t.key === "hot" ? plans.some((p) => p.hot) : present.has(t.key as Bucket)),
    );
  }, [plans]);

  const [tab, setTab] = useState<Bucket | "hot">(() =>
    plans.some((p) => p.hot) ? "hot" : ((plans[0]?.bucket ?? "other") as Bucket),
  );

  const shown = useMemo(() => {
    // The API already returns plans best-value first, so no re-sorting here.
    if (tab === "hot") return plans.filter((p) => p.hot);
    return plans.filter((p) => (p.bucket ?? "other") === tab);
  }, [plans, tab]);

  if (plans.length === 0) {
    return <p className="mt-4 text-sm text-muted">No plans available right now.</p>;
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-muted">Data plans</p>
      </div>

      {/* Duration tabs */}
      <div className="-mx-5 mb-4 overflow-x-auto px-5">
        <div className="flex w-max gap-5 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`min-h-[44px] whitespace-nowrap border-b-2 px-1 pb-2 text-sm font-semibold transition-colors ${
                tab === t.key
                  ? "border-brand text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map((p) => {
          const cb = cashbackNaira(p.amount, cashback);
          const selected = selectedId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`relative flex min-h-[112px] flex-col rounded-2xl border p-3 text-left transition-transform active:scale-[0.98] ${
                selected ? "border-brand bg-card ring-1 ring-brand" : "border-border bg-card"
              }`}
            >
              {p.bestValue && (
                <span className="absolute right-2 top-2 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                  Best value
                </span>
              )}

              <span className="text-xl font-extrabold leading-tight text-ink">
                {p.sizeLabel ?? p.name}
              </span>
              {p.validityLabel && (
                <span className="mt-0.5 text-xs text-muted">{p.validityLabel}</span>
              )}

              <span className="mt-auto pt-2 text-base font-bold text-ink">
                ₦{money(Number(p.amount))}
              </span>

              {cb !== null && (
                <span className="text-xs font-semibold text-brand">₦{money(cb)} Cashback</span>
              )}
              {p.nairaPerGb !== null && p.nairaPerGb !== undefined && (
                <span className="text-[10px] text-muted">₦{money(Math.round(p.nairaPerGb))}/GB</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
