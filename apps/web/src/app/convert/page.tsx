"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronDown, ArrowUpDown } from "lucide-react";
import AppShell from "@/components/AppShell";
import { CoinBadge } from "@/components/MobileUI";

// Mock conversion rate (1 BTC ≈ 30.47 ETH) just for the preview UI.
const BTC_TO_ETH = 30.47;
const BTC_BALANCE = 0.9;
const ETH_BALANCE = 20;

function AssetCard({
  role,
  symbol,
  amount,
  balance,
  emphasize,
}: {
  role: string;
  symbol: "BTC" | "ETH";
  amount: string;
  balance: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-3xl bg-card p-5">
      <div className="flex items-center justify-between">
        <button className="flex items-center gap-2">
          <CoinBadge symbol={symbol} />
          <span className="text-lg font-bold text-ink">{symbol}</span>
          <ChevronDown className="h-4 w-4 text-muted" />
        </button>
        <span className="text-xs font-semibold tracking-widest text-muted">
          {role}
        </span>
      </div>
      <p
        className={`mt-3 text-center font-extrabold text-ink ${
          emphasize ? "text-[40px]" : "text-[34px]"
        } leading-none`}
      >
        {amount}
      </p>
      <p className="mt-2 text-center text-sm text-muted">
        Balance: <span className="font-semibold text-ink">{balance}</span>
      </p>
    </div>
  );
}

export default function ConvertPage() {
  const router = useRouter();
  const [source, setSource] = useState("0.75");

  const sourceNum = parseFloat(source || "0") || 0;
  const targetNum = sourceNum * BTC_TO_ETH;
  const target = targetNum.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  const targetRaw = targetNum.toFixed(2);

  const previewSwap = () => {
    const q = new URLSearchParams({
      from: source,
      to: targetRaw,
      fromSym: "BTC",
      toSym: "ETH",
    }).toString();
    router.push(`/convert/confirm?${q}`);
  };

  const press = (key: string) => {
    setSource((prev) => {
      if (key === "del") return prev.length <= 1 ? "0" : prev.slice(0, -1);
      const next = prev === "0" && key !== "." ? key : prev + key;
      // guard against silly lengths
      return next.length > 12 ? prev : next;
    });
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"];

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center px-5 pb-2 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 pr-10 text-center text-lg font-bold text-ink">
          Convert
        </h1>
      </div>

      {/* Swap cards */}
      <div className="relative px-5">
        <AssetCard
          role="SOURCE"
          symbol="BTC"
          amount={source}
          balance={`${BTC_BALANCE} BTC`}
          emphasize
        />

        {/* Swap toggle */}
        <div className="relative z-10 -my-4 flex justify-center">
          <button
            className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg"
            style={{ backgroundColor: "#6B5B95" }}
          >
            <ArrowUpDown className="h-5 w-5" />
          </button>
        </div>

        <AssetCard
          role="TOKEN"
          symbol="ETH"
          amount={target}
          balance={`${ETH_BALANCE} ETH`}
        />
      </div>

      {/* Keypad */}
      <div className="mt-6 grid grid-cols-3 gap-3 px-5">
        {keys.map((key) => (
          <button
            key={key}
            onClick={() => press(key)}
            className="flex h-14 items-center justify-center rounded-2xl bg-card text-xl font-semibold text-ink transition active:scale-95"
          >
            {key === "del" ? "⌫" : key}
          </button>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-6 px-5">
        <button
          onClick={previewSwap}
          className="w-full rounded-full py-4 text-base font-bold text-white"
          style={{ backgroundColor: "#6B5B95" }}
        >
          Preview Swap
        </button>
      </div>
    </AppShell>
  );
}
