"use client";

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

const assets = [
  { symbol: "BTC", name: "Bitcoin", amount: "0 BTC", fiat: "0 NGN", bg: "#F7931A", glyph: "₿" },
  { symbol: "USDT", name: "Tether", amount: "0 USDT", fiat: "0 NGN", bg: "#26A17B", glyph: "₮" },
];

const transactions = [
  { title: "Sold BTC", date: "Jun 21, 2026", amount: "-0.00069782 BTC", fiat: "60,678.8 NGN", positive: false, bg: "#F7931A", glyph: "₿" },
  { title: "Received BTC", date: "Jun 21, 2026", amount: "0.00069782 BTC", fiat: "60,655.17 NGN", positive: true, bg: "#F7931A", glyph: "₿" },
  { title: "Sold USDT", date: "Jun 21, 2026", amount: "-2,000 USDT", fiat: "2,000 NGN", positive: false, bg: "#26A17B", glyph: "₮" },
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

  return (
    <AppShell>
      <TopBar
        name={user?.full_name}
        icons={[
          { icon: Search },
          { icon: showBalance ? Eye : EyeOff, onClick: toggleBalance },
          { icon: Bell },
        ]}
      />

      <BalanceBlock label="Total Crypto Balance" amount={showBalance ? "₦0.00" : "₦••••"} />

      <ActionRow>
        <CircleAction icon={TrendingUp} label="Trade" onClick={() => router.push("/convert")} />
        <CircleAction icon={ArrowDown} label="Receive" />
        <CircleAction icon={ArrowRight} label="Send" onClick={() => router.push("/send")} />
      </ActionRow>

      {/* Assets */}
      <div className="mb-6 px-5">
        <Card>
          {assets.map((asset, i) => (
            <div
              key={asset.symbol}
              className={`flex items-center justify-between ${i > 0 ? "mt-5" : ""}`}
            >
              <div className="flex items-center">
                <CoinIcon bg={asset.bg} glyph={asset.glyph} />
                <div className="ml-3">
                  <p className="text-lg font-bold text-ink">{asset.symbol}</p>
                  <p className="text-sm text-muted">{asset.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-ink">
                  {showBalance ? asset.amount : "••••"}
                </p>
                <p className="text-sm text-muted">{asset.fiat}</p>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Transactions */}
      <div className="px-5">
        <SectionHeader title="Transactions" onClick={() => router.push("/transactions")} />
        <Card>
          {transactions.map((tx, i) => (
            <div
              key={`${tx.title}-${i}`}
              className={`flex items-center justify-between ${i > 0 ? "mt-5" : ""}`}
            >
              <div className="flex flex-1 items-center">
                <CoinIcon bg={tx.bg} glyph={tx.glyph} />
                <div className="ml-3">
                  <p className="text-base font-bold text-ink">{tx.title}</p>
                  <p className="text-sm text-muted">{tx.date}</p>
                </div>
              </div>
              <div className="text-right">
                <p
                  className="text-base font-bold"
                  style={{ color: tx.positive ? "#34C759" : "#F4F3F7" }}
                >
                  {tx.amount}
                </p>
                <p className="text-sm text-muted">{tx.fiat}</p>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </AppShell>
  );
}
