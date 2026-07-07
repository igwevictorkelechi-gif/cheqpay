"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { api, type LedgerTransaction } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";
import { txnIcon, txnTitle, txnStatusBadge } from "@/components/TxnRow";

const CACHE = "cheqpay:notifications";

/** Human, notification-style line for a transaction. */
function messageFor(t: LedgerTransaction): string {
  const amt = `₦${Number(t.amountFormatted).toLocaleString("en-NG")}`;
  switch (t.type) {
    case "DEPOSIT":
      return t.status === "COMPLETED"
        ? `${amt} was added to your wallet.`
        : `Your deposit of ${amt} is being confirmed.`;
    case "WITHDRAWAL":
      return t.status === "COMPLETED"
        ? `Your withdrawal was sent successfully.`
        : t.status === "REVERSED" || t.status === "FAILED"
          ? `Your withdrawal failed and was refunded.`
          : `Your withdrawal is processing.`;
    case "BILL":
      return t.status === "COMPLETED"
        ? `${txnTitle(t)} paid successfully.`
        : `${txnTitle(t)} is processing.`;
    default:
      return `${txnTitle(t)} — ${t.status.toLowerCase()}.`;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

export default function NotificationsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<LedgerTransaction[]>(
    () => readCache<LedgerTransaction[]>(CACHE) ?? []
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    api
      .getTransactions(15)
      .then(({ transactions }) => {
        if (!active) return;
        setItems(transactions);
        writeCache(CACHE, transactions);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-0 flex h-full w-full max-w-[480px] flex-col bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-ink">Notifications</h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-24 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-card">
                <Bell className="h-7 w-7 text-muted" />
              </span>
              <p className="mt-4 font-bold text-ink">You&apos;re all caught up</p>
              <p className="mt-1 text-sm text-muted">
                {loading ? "Loading…" : "Deposits, withdrawals and payments will show up here."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((t) => {
                const { Icon, color, bg } = txnIcon(t.type);
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      onClose();
                      router.push(`/transaction/${t.id}`);
                    }}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left active:bg-card"
                  >
                    <span
                      className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: bg }}
                    >
                      <Icon className="h-5 w-5" style={{ color }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">{messageFor(t)}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-muted">{relativeTime(t.createdAt)}</span>
                        {txnStatusBadge(t.status)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
