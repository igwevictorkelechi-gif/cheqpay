"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Eye, EyeOff, Bell, TrendingUp, ArrowDown, ArrowRight } from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  TopBar,
  BalanceBlock,
  ActionRow,
  CircleAction,
  Card,
  SectionHeader,
  useToast,
} from "@/components/MobileUI";
import { useAuthStore, useUIStore } from "@/store";
import { api, ApiError } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";

const BAL_CACHE = "cheqpay:crypto:bal";
const NGN_CACHE = "cheqpay:crypto:ngn";

const assetMeta = [
  { symbol: "BTC" as const, name: "Bitcoin", bg: "#F7931A", glyph: "₿" },
  { symbol: "USDT" as const, name: "Tether", bg: "#26A17B", glyph: "₮" },
];

function CoinIcon({ bg, glyph }: { bg: string; glyph: string }) {
  return (
    <span
      className="flex h-11 w-11 items-center justify-center rounded-full text-xl font-bold text-white"
      style={{ backgroundColor: bg }}
    >
      {glyph}
    </span>
  );
}

export default function CryptoPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { showBalance, toggleBalance } = useUIStore();
  // Paint last-known balances instantly from cache, then refresh in the
  // background so the screen never blocks on the network.
  const [bal, setBal] = useState<Record<string, string>>(
    () => readCache<Record<string, string>>(BAL_CACHE) ?? {}
  );
  const [ngn, setNgn] = useState<Record<string, number>>(
    () => readCache<Record<string, number>>(NGN_CACHE) ?? {}
  );

  useEffect(() => {
    let active = true;

    async function refresh() {
      const [{ balances }, btc, usdt] = await Promise.all([
        api.getBalances(),
        api.getPrice("BTC").catch(() => null),
        api.getPrice("USDT").catch(() => null),
      ]);
      if (!active) return;
      const map: Record<string, string> = {};
      for (const b of balances) map[b.asset] = b.availableFormatted;
      const prices: Record<string, number> = {
        BTC: btc?.priceNgn ? Number(btc.priceNgn) : 0,
        USDT: usdt?.priceNgn ? Number(usdt.priceNgn) : 0,
      };
      const value: Record<string, number> = {};
      for (const a of ["BTC", "USDT"]) value[a] = Number(map[a] ?? 0) * prices[a];
      setBal(map);
      setNgn(value);
      writeCache(BAL_CACHE, map);
      writeCache(NGN_CACHE, value);
    }

    (async () => {
      try {
        await refresh();
      } catch (e) {
        // First-time users may not be provisioned yet — provision then retry once.
        if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
          try {
            await api.ensureProvisioned();
            await refresh();
          } catch {
            /* still failing — keep cached/zero values */
          }
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const totalNgn = (ngn.BTC ?? 0) + (ngn.USDT ?? 0);
  const fmtNgn = (n: number) =>
    "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toast = useToast();

  return (
    <AppShell>
      <TopBar
        name={user?.full_name}
        onAvatar={() => router.push("/profile")}
        icons={[
          { icon: Search, onClick: () => router.push("/transactions") },
          { icon: showBalance ? Eye : EyeOff, onClick: toggleBalance },
          { icon: Bell, onClick: () => toast.show("No new notifications") },
        ]}
      />

      <BalanceBlock
        label="Total Crypto Balance"
        amount={showBalance ? fmtNgn(totalNgn) : "₦••••"}
      />

      <ActionRow>
        <CircleAction icon={TrendingUp} label="Trade" onClick={() => router.push("/asset/BTC")} />
        <CircleAction icon={ArrowDown} label="Receive" onClick={() => router.push("/receive")} />
        <CircleAction icon={ArrowRight} label="Send" onClick={() => router.push("/send-crypto")} />
      </ActionRow>

      {/* Assets — tap to open the asset page */}
      <div className="mb-6 px-5">
        <Card>
          {assetMeta.map((asset, i) => (
            <button
              key={asset.symbol}
              onClick={() => router.push(`/asset/${asset.symbol}`)}
              className={`flex w-full items-center justify-between ${i > 0 ? "mt-5" : ""}`}
            >
              <div className="flex items-center">
                <CoinIcon bg={asset.bg} glyph={asset.glyph} />
                <div className="ml-3 text-left">
                  <p className="text-lg font-bold text-ink">{asset.symbol}</p>
                  <p className="text-sm text-muted">{asset.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-ink">
                  {showBalance ? `${bal[asset.symbol] ?? "0"} ${asset.symbol}` : "••••"}
                </p>
                <p className="text-sm text-muted">
                  {showBalance ? fmtNgn(ngn[asset.symbol] ?? 0) : "••••"}
                </p>
              </div>
            </button>
          ))}
        </Card>
      </div>

      {/* Transactions */}
      <div className="px-5">
        <SectionHeader title="Transactions" onClick={() => router.push("/transactions")} />
        <Card>
          <p className="py-2 text-center text-sm text-muted">
            Your crypto transactions will appear here.
          </p>
        </Card>
      </div>
      {toast.node}
    </AppShell>
  );
}
