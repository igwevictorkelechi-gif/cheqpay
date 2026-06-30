"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowDownUp,
  RefreshCw,
  Zap,
} from "lucide-react";
import type { LedgerTransaction } from "@/services/api";

export function txnIcon(type: LedgerTransaction["type"]) {
  switch (type) {
    case "DEPOSIT":
      return { Icon: ArrowDownLeft, color: "#34C759", bg: "rgba(52,199,89,0.15)" };
    case "WITHDRAWAL":
      return { Icon: ArrowUpRight, color: "#FF6B6B", bg: "rgba(255,107,107,0.15)" };
    case "CONVERT":
      return { Icon: RefreshCw, color: "#A78BFA", bg: "rgba(167,139,250,0.15)" };
    case "BILL":
      return { Icon: Zap, color: "#FBBF24", bg: "rgba(251,191,36,0.15)" };
    case "BUY":
    case "SELL":
    default:
      return { Icon: ArrowDownUp, color: "#A78BFA", bg: "rgba(167,139,250,0.15)" };
  }
}

export function txnTitle(t: LedgerTransaction): string {
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
    case "BILL": {
      const svc = t.billerName ?? t.service ?? "Bill";
      return t.planName ? `${svc} · ${t.planName}` : svc;
    }
    default:
      return t.type;
  }
}

function fmt(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 8 }) : v;
}

/** Primary signed amount line (what the balance net is, best-effort). */
export function txnAmount(t: LedgerTransaction): { text: string; positive: boolean } {
  if (t.type === "DEPOSIT") return { text: `+${fmt(t.amountFormatted)} ${t.asset}`, positive: true };
  if (t.type === "WITHDRAWAL")
    return { text: `-${fmt(t.amountFormatted)} ${t.asset}`, positive: false };
  if (t.type === "BILL")
    return { text: `-₦${fmt(t.amountFormatted)}`, positive: false };
  // BUY / SELL / CONVERT show the received leg as the headline.
  if (t.toAsset && t.toFormatted)
    return { text: `+${fmt(t.toFormatted)} ${t.toAsset}`, positive: true };
  return { text: `${fmt(t.amountFormatted)} ${t.asset}`, positive: true };
}

export function txnStatusBadge(status: LedgerTransaction["status"]) {
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

/** One transaction row, used by the history page, home and crypto screens. */
export default function TxnRow({
  t,
  showStatus = true,
  divider = false,
}: {
  t: LedgerTransaction;
  showStatus?: boolean;
  divider?: boolean;
}) {
  const { Icon, color, bg } = txnIcon(t.type);
  const amt = txnAmount(t);
  return (
    <div
      className={`flex items-center gap-3 px-4 py-4 ${divider ? "border-t border-border" : ""}`}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: bg }}
      >
        <Icon className="h-5 w-5" style={{ color }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-ink">{txnTitle(t)}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs text-muted">
            {new Date(t.createdAt).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "short",
            })}
          </span>
          {showStatus && txnStatusBadge(t.status)}
        </div>
      </div>
      <div className="text-right">
        <p className={`font-bold ${amt.positive ? "text-green-400" : "text-ink"}`}>{amt.text}</p>
        {t.type === "CONVERT" && t.fromFormatted && (
          <p className="text-xs text-muted">
            -{Number(t.fromFormatted).toLocaleString("en-US", { maximumFractionDigits: 8 })}{" "}
            {t.fromAsset}
          </p>
        )}
      </div>
    </div>
  );
}
