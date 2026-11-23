"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import TxnRow, { txnAmount } from "@/components/TxnRow";
import { CapsLabel } from "@/components/MobileUI";
import type { LedgerTransaction } from "@/services/api";

type Filter = "all" | "in" | "out" | "pending";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in", label: "Money in" },
  { key: "out", label: "Money out" },
  { key: "pending", label: "Pending" },
];

const inFlight = (t: LedgerTransaction) => t.status === "PENDING" || t.status === "PROCESSING";

function matches(t: LedgerTransaction, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "pending") return inFlight(t);
  const positive = txnAmount(t).positive;
  return f === "in" ? positive : !positive;
}

/** "Today", "Yesterday", or "Mon 16 Nov", in Lagos time. */
function dayLabel(iso: string, now: Date): string {
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const d = new Date(iso);
  if (key(d) === key(now)) return "Today";
  if (key(d) === key(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

/**
 * v2 Activity: filter chips, then one card per day under a caps date header
 * sitting straight on the page. A withdrawal still on its way gets its own
 * elevated card with a three-step timeline — elevation does the "this one is
 * live" work, and the active step is the screen's one brand accent.
 */
export default function ActivityList({ txns }: { txns: LedgerTransaction[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const open = (t: LedgerTransaction) => router.push(`/transaction?id=${t.id}`);

  const groups = useMemo(() => {
    const now = new Date();
    const out: { label: string; live: LedgerTransaction[]; rest: LedgerTransaction[] }[] = [];
    for (const t of txns.filter((x) => matches(x, filter))) {
      const label = dayLabel(t.createdAt, now);
      let g = out[out.length - 1];
      if (!g || g.label !== label) out.push((g = { label, live: [], rest: [] }));
      (t.type === "WITHDRAWAL" && inFlight(t) ? g.live : g.rest).push(t);
    }
    return out;
  }, [txns, filter]);

  return (
    <>
      <div className="sticky top-0 z-10 -mx-5 mb-2 flex gap-2 overflow-x-auto bg-surface px-5 py-2 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold transition-colors ${
              filter === f.key ? "bg-ink text-surface" : "bg-card text-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">Nothing here.</p>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="mt-4">
            <CapsLabel className="mb-2.5 block">{g.label}</CapsLabel>
            {g.live.map((t) => (
              <div key={t.id} className="mb-3 overflow-hidden rounded-3xl border border-border bg-card shadow-[0_10px_24px_-6px_rgba(0,0,0,0.55)]">
                <TxnRow t={t} onClick={() => open(t)} />
                <WithdrawalTimeline t={t} />
              </div>
            ))}
            {g.rest.length > 0 && (
              <div className="overflow-hidden rounded-3xl border border-border bg-card">
                {g.rest.map((t, i) => (
                  <TxnRow key={t.id} t={t} divider={i > 0} onClick={() => open(t)} />
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </>
  );
}

/** Left your wallet ✓ → With the bank ◉ → In your bank account ○ */
function WithdrawalTimeline({ t }: { t: LedgerTransaction }) {
  const at = new Date(t.createdAt).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
  const steps = [
    { state: "done", title: "Left your wallet", meta: at },
    { state: "active", title: "With the bank", meta: "Now · crediting the account" },
    { state: "todo", title: "In your bank account", meta: "Usually under 2 min" },
  ] as const;
  return (
    <ol className="pb-4 pl-[68px] pr-4">
      {steps.map((s, i) => (
        <li key={s.title} className="relative flex gap-3 pb-3 last:pb-0">
          {i < steps.length - 1 && <span className="absolute left-[9px] top-6 h-[calc(100%-18px)] w-0.5 bg-hairline" aria-hidden />}
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              s.state === "done"
                ? "bg-positive/20 text-positive"
                : s.state === "active"
                  ? "border-2 border-brand bg-brand/20"
                  : "border-2 border-border"
            }`}
          >
            {s.state === "done" && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          <span className="min-w-0">
            <span className={`block text-[15px] font-semibold ${s.state === "todo" ? "text-muted" : "text-ink"}`}>{s.title}</span>
            <span className="block text-[13px] text-muted">{s.meta}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
