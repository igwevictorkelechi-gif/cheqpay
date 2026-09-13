"use client";

import { useMemo, useState } from "react";
import { Grid, LayoutGrid, Info } from "lucide-react";
import type { BillCashback, BillPlan } from "@/services/api";

/**
 * The data-bundle picker.
 *
 * A provider returns bundles in its own storage order, which buries the good
 * deals — so the API ranks them by naira-per-gigabyte and flags the strongest
 * ones. This renders that ranking: HOT leads with the best plan from each
 * duration (not just the cheapest per GB, which would be all monthly bundles
 * and nothing for someone who needs data today), and the category tabs let a
 * customer who knows what they want go straight there.
 *
 * Every figure shown is one we actually hold: the provider's live price, the
 * cashback computed from the same rate the award path pays, and a bonus label
 * read from the provider's own bundle name. Nothing is illustrative.
 */

type Bucket = NonNullable<BillPlan["bucket"]>;
type TabKey = Bucket | "hot" | "night";

const TABS: { key: TabKey; label: string }[] = [
  { key: "hot", label: "HOT" },
  { key: "night", label: "Extra Night" },
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

/** "250MB" -> ["250", "MB"], so the unit can be set smaller than the number. */
function splitSize(label: string | null | undefined): [string, string] {
  if (!label) return ["", ""];
  const m = /^([\d.]+)\s*([A-Za-z]+)$/.exec(label);
  return m ? [m[1], m[2]] : [label, ""];
}

function matches(p: BillPlan, tab: TabKey): boolean {
  if (tab === "hot") return !!p.hot;
  if (tab === "night") return !!p.night;
  return (p.bucket ?? "other") === tab;
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
  const tabs = useMemo(
    () => TABS.filter((t) => plans.some((p) => matches(p, t.key))),
    [plans],
  );

  const [tab, setTab] = useState<TabKey>(() => tabs[0]?.key ?? "hot");
  const [dense, setDense] = useState(true);

  const shown = useMemo(
    // The API already returns plans best-value first, so no re-sorting here.
    () => plans.filter((p) => matches(p, tab)),
    [plans, tab],
  );

  if (plans.length === 0) {
    return (
      <div className="mt-6 rounded-3xl bg-card p-5">
        <p className="text-sm text-muted">No plans available right now.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-3xl bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-extrabold text-ink">Data Plans</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDense(true)}
            aria-label="Compact grid"
            aria-pressed={dense}
            className={dense ? "text-brand" : "text-muted"}
          >
            <Grid className="h-6 w-6" />
          </button>
          <button
            onClick={() => setDense(false)}
            aria-label="Large grid"
            aria-pressed={!dense}
            className={!dense ? "text-brand" : "text-muted"}
          >
            <LayoutGrid className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex w-max gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`min-h-[44px] whitespace-nowrap border-b-2 pb-1.5 text-base font-bold transition-colors ${
                tab === t.key ? "border-brand text-ink" : "border-transparent text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid gap-3 ${dense ? "grid-cols-3" : "grid-cols-2"}`}>
        {shown.map((p) => {
          const cb = cashbackNaira(p.amount, cashback);
          const selected = selectedId === p.id;
          const [num, unit] = splitSize(p.sizeLabel);
          const footer = p.bonusLabel ?? (p.night ? "Night Plan" : null);

          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`relative flex flex-col overflow-hidden rounded-2xl border text-left transition-transform active:scale-[0.98] ${
                selected ? "border-brand ring-1 ring-brand" : "border-border"
              } bg-surface`}
            >
              {p.bestValue && (
                <span className="absolute right-0 top-0 rounded-bl-lg bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                  Best
                </span>
              )}

              <div className="flex flex-1 flex-col px-2.5 pb-2.5 pt-4">
                <p className="font-extrabold leading-none text-ink">
                  <span className="text-2xl">{num || p.name}</span>
                  {unit && <span className="ml-0.5 text-sm">{unit}</span>}
                </p>
                {p.validityLabel && (
                  <p className="mt-1.5 text-sm text-muted">{p.validityLabel}</p>
                )}

                <p className="mt-auto pt-2 text-base text-ink">₦{money(Number(p.amount))}</p>

                {cb !== null && (
                  <p className="text-xs font-semibold text-brand">₦{money(cb)} Cashback</p>
                )}
                {p.nairaPerGb !== null && p.nairaPerGb !== undefined && (
                  <p className="text-[10px] text-muted">
                    ₦{money(Math.round(p.nairaPerGb))}/GB
                  </p>
                )}
              </div>

              {footer && (
                <span
                  title={footer}
                  className="flex items-center justify-between gap-1 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-500"
                >
                  <span className="truncate">{footer}</span>
                  <Info className="h-3 w-3 shrink-0" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
