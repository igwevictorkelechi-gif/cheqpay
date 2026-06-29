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
} from "@/components/MobileUI";
import { useAuthStore, useUIStore } from "@/store";
import { api } from "@/services/api";

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
  const [bal, setBal] = useState<Record<string, string>>({});
  const [ngn, setNgn] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.ensureProvisioned();
        const [{ balances }, btc, usdt] = await Promise.all([
          api.getBalances(),
          api.getPrice("BTC").catch(() => null),
          api.getPrice("USDT").catch(() => null),
        ]);
        if (!active) return;
        const map: Record<string, string> = {};
        for (const b of balances) map[b.asset] = b.availableFormatted;
        setBal(map);
        const prices: Record<string, number> = {
          BTC: btc?.priceNgn ? Number(btc.priceNgn) : 0,
          USDT: usdt?.priceNgn ? Number(usdt.priceNgn) : 0,
        };
        const value: Record<string, number> = {};
        for (const a of ["BTC", "USDT"]) value[a] = Number(map[a] ?? 0) * prices[a];
        setNgn(value);
      } catch {
        /* not logged in / API unavailable — show zeros */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const totalNgn = (ngn.BTC ?? 0) + (ngn.USDT ?? 0);
  const fmtNgn = (n: number) =>
    "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <AppShell>
      <TopBar
        name={user?.full_name}
        onAvatar={() => router.push("/profile")}
        icons={[
          { icon: Search },
          { icon: showBalance ? Eye : EyeOff, onClick: toggleBalance },
          { icon: Bell },
        ]}
      />

      <BalanceBlock
        label="Total Crypto Balance"
        amount={showBalance ? fmtNgn(totalNgn) : "₦••••"}
      />

      <ActionRow>
        <CircleAction icon={TrendingUp} label="Trade" onClick={() => router.push("/asset/BTC")} />
        <CircleAction icon={ArrowDown} label="Receive" />
        <CircleAction icon={ArrowRight} label="Send" onClick={() => router.push("/send")} />
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
    </AppShell>
  );
}
