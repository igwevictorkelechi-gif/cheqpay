"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowDownUp,
  RefreshCw,
  Receipt,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { api, getAccessToken, type LedgerTransaction } from "@/services/api";

function iconFor(type: LedgerTransaction["type"]) {
  switch (type) {
    case "DEPOSIT":
      return { Icon: ArrowDownLeft, color: "#34C759", bg: "rgba(52,199,89,0.15)" };
    case "WITHDRAWAL":
      return { Icon: ArrowUpRight, color: "#FF6B6B", bg: "rgba(255,107,107,0.15)" };
    case "CONVERT":
      return { Icon: RefreshCw, color: "#A78BFA", bg: "rgba(167,139,250,0.15)" };
    case "BUY":
    case "SELL":
    default:
      return { Icon: ArrowDownUp, color: "#A78BFA", bg: "rgba(167,139,250,0.15)" };
  }
}

function titleFor(t: LedgerTransaction): string {
  switch (t.type) {
    case "DEPOSIT":
      return `Received ${t.asset}`;
    case "WITHDRAWAL":
      return `Sent ${t.asset}`;
    case "BUY":
      return `Bought ${t.toAsset ?? t.asset}`;
    case "SELL":
      return `Sold ${t.fromAsset ?? t.asset}`;
    case "CONVERT":
      return `Convert ${t.fromAsset ?? "?"} → ${t.toAsset ?? "?"}`;
    default:
      return t.type;
  }
}

/** Primary signed amount line (what the balance net is, best-effort). */
function amountLine(t: LedgerTransaction): { text: string; positive: boolean } {
  if (t.type === "DEPOSIT") return { text: `+${t.amountFormatted} ${t.asset}`, positive: true };
  if (t.type === "WITHDRAWAL")
    return { text: `-${t.amountFormatted} ${t.asset}`, positive: false };
  // BUY / SELL / CONVERT show the received leg as the headline.
  if (t.toAsset && t.toFormatted)
    return { text: `+${t.toFormatted} ${t.toAsset}`, positive: true };
  return { text: `${t.amountFormatted} ${t.asset}`, positive: true };
}

function statusBadge(status: LedgerTransaction["status"]) {
  const map: Record<string, { label: string; cls: string }> = {
    COMPLETED: { label: "Completed", cls: "bg-green-500/15 text-green-400" },
    PROCESSING: { label: "Processing", cls: "bg-amber-500/15 text-amber-400" },
    PENDING: { label: "Pending", cls: "bg-amber-500/15 text-amber-400" },
    FAILED: { label: "Failed", cls: "bg-red-500/15 text-red-400" },
    REVERSED: { label: "Reversed", cls: "bg-red-500/15 text-red-400" },
  };
  const s = map[status] ?? { label: status, cls: "bg-white/10 text-muted" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

export default function TransactionsPage() {
  const router = useRouter();
  const [txns, setTxns] = useState<LedgerTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          setNeedsLogin(true);
          return;
        }
        await api.ensureProvisioned();
        const { transactions } = await api.getTransactions(100);
        setTxns(transactions);
      } catch {
        setNeedsLogin(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AppShell>
      <div className="px-5 pb-4 pt-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold text-ink">Transactions</h1>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-card" />
              ))}
            </div>
          ) : needsLogin ? (
            <div className="py-16 text-center">
              <Receipt className="mx-auto mb-4 h-12 w-12 text-muted" />
              <p className="text-muted">Sign in to see your transactions.</p>
            </div>
          ) : txns.length === 0 ? (
            <div className="py-16 text-center">
              <Receipt className="mx-auto mb-4 h-12 w-12 text-muted" />
              <p className="text-muted">No transactions yet.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl bg-card">
              {txns.map((t, i) => {
                const { Icon, color, bg } = iconFor(t.type);
                const amt = amountLine(t);
                return (
                  <div
                    key={t.id}
                    className={`flex items-center gap-3 px-4 py-4 ${
                      i > 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: bg }}
                    >
                      <Icon className="h-5 w-5" style={{ color }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-ink">{titleFor(t)}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-xs text-muted">
                          {new Date(t.createdAt).toLocaleDateString("en-NG", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                        {statusBadge(t.status)}
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-bold ${amt.positive ? "text-green-400" : "text-ink"}`}
                      >
                        {amt.text}
                      </p>
                      {t.type === "CONVERT" && t.fromFormatted && (
                        <p className="text-xs text-muted">
                          -{t.fromFormatted} {t.fromAsset}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
