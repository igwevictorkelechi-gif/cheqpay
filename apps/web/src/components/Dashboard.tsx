"use client";

import PushPrompt from "@/components/PushPrompt";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Eye,
  EyeOff,
  Bell,
  ArrowDown,
  RefreshCw,
  Receipt,
  Send,
  Users,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  TopBar,
  BalanceBlock,
  ActionRow,
  CircleAction,
  SectionHeader,
  useToast,
} from "@/components/MobileUI";
import TxnRow from "@/components/TxnRow";
import KycBanner from "@/components/KycBanner";
import NotificationsSheet from "@/components/NotificationsSheet";
import PromoPopup from "@/components/PromoPopup";
import HomeBannerCarousel, { useHomeBanners } from "@/components/HomeBanner";
import { useFeatures } from "@/lib/useFeatures";
import { authService } from "@/services/auth";
import { useAuthStore, useUIStore } from "@/store";
import { api, ApiError, type LedgerTransaction } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";
import NearbyStrip from "@/components/NearbyStrip";
import NextUpCard from "@/components/NextUpCard";

const CASH_CACHE = "cheqpay:cash";
const USD_CACHE = "cheqpay:usd";
// Transactions are cached per currency: the two tabs show different lists, and
// sharing one cache key would flash the wrong currency's history on switch.
const HOME_TX_CACHE = "cheqpay:home:txns";
const HOME_TX_CACHE_USD = "cheqpay:home:txns:usd";

export default function Dashboard() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const { showBalance, toggleBalance } = useUIStore();
  const features = useFeatures();
  const banners = useHomeBanners();
  const toast = useToast();
  const [notifOpen, setNotifOpen] = useState(false);

  // NGN cash balance from the custody ledger (where deposits + crypto sells land).
  const [ngn, setNgn] = useState<number>(() => readCache<number>(CASH_CACHE) ?? 0);
  // USD balance (from USD virtual-account deposits), and which currency the
  // balance block is showing.
  const [usd, setUsd] = useState<number>(() => readCache<number>(USD_CACHE) ?? 0);
  const [currency, setCurrency] = useState<"NGN" | "USD">("NGN");
  // Whether the figures on screen are real: loaded this visit, or a cached
  // copy from the last one. When neither, the balance is unknown — and must
  // not be drawn as ₦0, which reads as "your money is gone".
  const [known, setKnown] = useState<boolean>(() => readCache<number>(CASH_CACHE) !== null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [ngnTxns, setNgnTxns] = useState<LedgerTransaction[]>(
    () => readCache<LedgerTransaction[]>(HOME_TX_CACHE) ?? []
  );
  const [usdTxns, setUsdTxns] = useState<LedgerTransaction[]>(
    () => readCache<LedgerTransaction[]>(HOME_TX_CACHE_USD) ?? []
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
      // Both currencies are fetched up front so switching tabs is instant and
      // never shows another currency's history while a request is in flight.
      const [{ balances }, ngnRes, usdRes] = await Promise.all([
        api.getBalances(),
        api.getTransactions(6, "NGN"),
        api.getTransactions(6, "USD"),
      ]);
      if (!active) return;
      const cash = Number(balances.find((b) => b.asset === "NGN")?.availableFormatted ?? 0);
      const dollars = Number(balances.find((b) => b.asset === "USD")?.availableFormatted ?? 0);
      setNgn(cash);
      setUsd(dollars);
      setKnown(true);
      setLoadFailed(false);
      setNgnTxns(ngnRes.transactions);
      setUsdTxns(usdRes.transactions);
      writeCache(CASH_CACHE, cash);
      writeCache(USD_CACHE, dollars);
      writeCache(HOME_TX_CACHE, ngnRes.transactions);
      writeCache(HOME_TX_CACHE_USD, usdRes.transactions);
    }

    (async () => {
      try {
        await refresh();
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          try {
            await api.ensureProvisioned();
            await refresh();
            return;
          } catch {
            /* fall through: say it failed */
          }
        }
        // Cached figures stay on screen; with none, the balance shows as
        // unavailable with a retry, never as zero.
        if (active) setLoadFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const isUsd = currency === "USD";
  const value = isUsd ? usd : ngn;
  const symbol = isUsd ? "$" : "₦";
  const locale = isUsd ? "en-US" : "en-NG";
  // Everything below the tab reads from the selected currency only.
  const txns = isUsd ? usdTxns : ngnTxns;
  const formattedBalance = !known
    ? `${symbol}—`
    : showBalance
    ? symbol +
      value.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : `${symbol}••••`;

  /**
   * USD payouts are not live yet. Rather than a dead button, point the user at
   * the conversion that does work — they can turn dollars into naira or crypto
   * and withdraw that.
   */
  const onWithdraw = () => {
    if (isUsd) {
      toast.show("USD withdrawals aren’t available yet — convert to Naira first.");
      router.push("/convert?from=USD");
      return;
    }
    router.push("/withdraw");
  };

  return (
    <AppShell>
      <TopBar
        name={user?.full_name}
        onAvatar={() => router.push("/profile")}
        icons={[
          { icon: Search, label: "View transactions", onClick: () => router.push("/transactions") },
          { icon: showBalance ? Eye : EyeOff, label: showBalance ? "Hide balance" : "Show balance", onClick: toggleBalance },
          { icon: Bell, label: "Notifications", onClick: () => setNotifOpen(true) },
        ]}
      />

      {/* Currency tab — switch the balance block between naira and dollars.
          Ink chips, not brand purple: v2 keeps purple for one accent a screen. */}
      <div className="mt-5 flex justify-center">
        <div className="inline-flex gap-1 rounded-full bg-card p-1">
          {(["NGN", "USD"] as const).map((c) => {
            const active = currency === c;
            return (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                aria-pressed={active}
                className={`flex min-h-[40px] items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors ${
                  active ? "bg-ink text-surface" : "text-muted hover:text-ink"
                }`}
              >
                <span>{c === "NGN" ? "🇳🇬" : "🇺🇸"}</span>
                {c}
              </button>
            );
          })}
        </div>
      </div>

      <BalanceBlock label={isUsd ? "Dollar balance" : "Total balance"} amount={formattedBalance} />
      {loadFailed ? (
        <div className="-mt-2 mb-4 flex justify-center px-5">
          <button
            onClick={() => { setLoadFailed(false); setReloadKey((k) => k + 1); }}
            className="min-h-[40px] rounded-full bg-card px-4 text-sm font-semibold text-ink"
          >
            {known ? "Couldn’t refresh your balance — tap to retry" : "Couldn’t load your balance — tap to retry"}
          </button>
        </div>
      ) : null}

      <KycBanner />

      <div className="px-5">
        <PushPrompt />
      </div>

      {/* First-run nudge: no money and no history yet, in this currency. */}
      {features.ngn_deposits && known && value === 0 && txns.length === 0 && (
        <div className="mb-6 px-5">
          <button
            onClick={() => router.push(isUsd ? "/deposit?currency=USD" : "/deposit")}
            className="flex w-full items-center gap-4 rounded-3xl bg-brand shadow-cta p-5 text-left active:scale-[0.99]"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20">
              <ArrowDown className="h-6 w-6 text-white" />
            </span>
            <div className="flex-1">
              <p className="text-base font-bold text-white">
                {isUsd ? "Add dollars to get started" : "Add money to get started"}
              </p>
              <p className="mt-0.5 text-sm text-white/80">
                {isUsd
                  ? "Open your USD account to receive dollars from anywhere."
                  : "Fund your wallet by bank transfer to buy crypto and pay bills."}
              </p>
            </div>
          </button>
        </div>
      )}

      {/* v2 quick actions: Add · Pay · Save · Convert. Pay is the one place to
          send money — to a bank account, a CheqPay user or a biller. */}
      <ActionRow>
        {features.ngn_deposits && (
          <CircleAction
            icon={ArrowDown}
            label="Add"
            onClick={() => router.push(isUsd ? "/deposit?currency=USD" : "/deposit")}
          />
        )}
        {(features.ngn_withdrawals || features.p2p_transfers || features.bill_payments) && (
          <CircleAction icon={Send} label="Pay" onClick={isUsd ? onWithdraw : () => router.push("/send")} />
        )}
        {features.ajo && <CircleAction icon={Users} label="Save" onClick={() => router.push("/ajo")} />}
        {features.crypto_trading && (
          <CircleAction icon={RefreshCw} label="Convert" onClick={() => router.push("/convert")} />
        )}
      </ActionRow>

      {!isUsd && <NextUpCard />}

      {/* Recent activity */}
      <div className="mb-6 px-5">
        <SectionHeader
          title="Recent activity"
          onClick={() => router.push(isUsd ? "/transactions?currency=USD" : "/transactions")}
        />
        {txns.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Receipt className="mb-2 h-9 w-9 text-muted" />
            <p className="text-sm text-muted">
              {isUsd ? "No dollar transactions yet." : "No naira transactions yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-border bg-card">
            {txns.slice(0, 5).map((t, i) => (
              <TxnRow key={t.id} t={t} divider={i > 0} onClick={() => router.push(`/transaction?id=${t.id}`)} />
            ))}
          </div>
        )}
      </div>

      {banners.length > 0 && (
        <div className="mb-6 px-5">
          <HomeBannerCarousel banners={banners} />
        </div>
      )}

      <NearbyStrip />
      {toast.node}
      <NotificationsSheet open={notifOpen} onClose={() => setNotifOpen(false)} />
      <PromoPopup />
    </AppShell>
  );
}
