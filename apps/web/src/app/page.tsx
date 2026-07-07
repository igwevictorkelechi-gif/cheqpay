"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Eye, EyeOff, Bell, ArrowDown, ArrowRight, RefreshCw, Receipt } from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  TopBar,
  BalanceBlock,
  ActionRow,
  CircleAction,
  Card,
  NairaFlag,
  SectionHeader,
  useToast,
} from "@/components/MobileUI";
import TxnRow from "@/components/TxnRow";
import KycBanner from "@/components/KycBanner";
import NotificationsSheet from "@/components/NotificationsSheet";
import { authService } from "@/services/auth";
import { useAuthStore, useUIStore } from "@/store";
import { api, ApiError, type LedgerTransaction } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";

const CASH_CACHE = "cheqpay:cash";
const HOME_TX_CACHE = "cheqpay:home:txns";

export default function HomePage() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const { showBalance, toggleBalance } = useUIStore();
  const toast = useToast();
  const [notifOpen, setNotifOpen] = useState(false);

  // NGN cash balance from the custody ledger (where deposits + crypto sells land).
  const [ngn, setNgn] = useState<number>(() => readCache<number>(CASH_CACHE) ?? 0);
  const [txns, setTxns] = useState<LedgerTransaction[]>(
    () => readCache<LedgerTransaction[]>(HOME_TX_CACHE) ?? []
  );

  // Keep the user's name fresh (best-effort; non-blocking).
  useEffect(() => {
    authService
      .getCurrentUser()
      .then((u) => u && setUser(u))
      .catch(() => undefined);
  }, [setUser]);

  useEffect(() => {
    let active = true;

    async function refresh() {
      const [{ balances }, { transactions }] = await Promise.all([
        api.getBalances(),
        api.getTransactions(6),
      ]);
      if (!active) return;
      const cash = Number(balances.find((b) => b.asset === "NGN")?.availableFormatted ?? 0);
      setNgn(cash);
      setTxns(transactions);
      writeCache(CASH_CACHE, cash);
      writeCache(HOME_TX_CACHE, transactions);
    }

    (async () => {
      try {
        await refresh();
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
          try {
            await api.ensureProvisioned();
            await refresh();
          } catch {
            /* keep cached values */
          }
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const formattedBalance = showBalance
    ? "₦" + ngn.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "₦••••";

  return (
    <AppShell>
      <TopBar
        name={user?.full_name}
        onAvatar={() => router.push("/profile")}
        icons={[
          { icon: Search, onClick: () => router.push("/transactions") },
          { icon: showBalance ? Eye : EyeOff, onClick: toggleBalance },
          { icon: Bell, onClick: () => setNotifOpen(true) },
        ]}
      />

      <BalanceBlock label="Total Cash Balance" amount={formattedBalance} />

      <KycBanner />

      {/* First-run nudge: no money and no history yet. */}
      {ngn === 0 && txns.length === 0 && (
        <div className="mb-6 px-5">
          <button
            onClick={() => router.push("/deposit")}
            className="flex w-full items-center gap-4 rounded-3xl bg-gradient-to-r from-brand to-brand-light p-5 text-left active:scale-[0.99]"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20">
              <ArrowDown className="h-6 w-6 text-white" />
            </span>
            <div className="flex-1">
              <p className="text-base font-bold text-white">Add money to get started</p>
              <p className="mt-0.5 text-sm text-white/80">
                Fund your wallet by bank transfer to buy crypto and pay bills.
              </p>
            </div>
          </button>
        </div>
      )}

      <ActionRow>
        <CircleAction icon={ArrowDown} label="Deposit" onClick={() => router.push("/deposit")} />
        <CircleAction icon={ArrowRight} label="Withdraw" onClick={() => router.push("/withdraw")} />
        <CircleAction icon={RefreshCw} label="Convert" onClick={() => router.push("/convert")} />
      </ActionRow>

      {/* Cash account */}
      <div className="mb-4 px-5">
        <Card>
          <p className="mb-4 text-base font-medium text-muted">Cash</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <NairaFlag />
              <div className="ml-3">
                <p className="text-lg font-bold text-ink">NGN</p>
                <p className="text-sm text-muted">Naira</p>
              </div>
            </div>
            <p className="text-lg font-bold text-ink">
              {showBalance
                ? `${ngn.toLocaleString("en-NG", { maximumFractionDigits: 2 })} NGN`
                : "•••• NGN"}
            </p>
          </div>
        </Card>
      </div>

      {/* Transactions */}
      <div className="px-5">
        <SectionHeader title="Transactions" onClick={() => router.push("/transactions")} />
        {txns.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Receipt className="mb-2 h-9 w-9 text-muted" />
            <p className="text-sm text-muted">No transactions yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl bg-card">
            {txns.slice(0, 5).map((t, i) => (
              <TxnRow key={t.id} t={t} showStatus={false} divider={i > 0} onClick={() => router.push(`/transaction/${t.id}`)} />
            ))}
          </div>
        )}
      </div>
      {toast.node}
      <NotificationsSheet open={notifOpen} onClose={() => setNotifOpen(false)} />
    </AppShell>
  );
}
