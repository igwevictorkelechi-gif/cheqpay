"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ArrowDown } from "lucide-react";
import AppShell from "@/components/AppShell";
import { CoinBadge } from "@/components/MobileUI";

const RATE = 30.47;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

function Leg({
  caption,
  amount,
  symbol,
}: {
  caption: string;
  amount: string;
  symbol: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-muted">{caption}</p>
        <p className="mt-1 text-2xl font-extrabold text-ink">
          {amount} <span className="text-lg">{symbol}</span>
        </p>
      </div>
      <CoinBadge symbol={symbol} size={44} />
    </div>
  );
}

function ConfirmInner() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "0.75";
  const to = params.get("to") || "22.85";
  const fromSym = params.get("fromSym") || "BTC";
  const toSym = params.get("toSym") || "ETH";
  const [processing, setProcessing] = useState(false);

  const confirm = () => {
    setProcessing(true);
    // Simulate the swap settling, then move to the success screen.
    setTimeout(() => {
      const q = new URLSearchParams({ from, to, fromSym, toSym }).toString();
      router.replace(`/convert/success?${q}`);
    }, 1200);
  };

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
          Confirm Swap
        </h1>
      </div>

      {/* Pay / receive */}
      <div className="px-5">
        <div className="relative rounded-3xl bg-card p-5">
          <Leg caption="You pay" amount={from} symbol={fromSym} />
          <div className="my-4 flex justify-center">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: "#6B5B95" }}
            >
              <ArrowDown className="h-4 w-4" />
            </span>
          </div>
          <Leg caption="You receive" amount={to} symbol={toSym} />
        </div>
      </div>

      {/* Details */}
      <div className="mt-4 px-5">
        <div className="rounded-3xl bg-card p-5">
          <Row label="Rate" value={`1 ${fromSym} = ${RATE} ${toSym}`} />
          <Row label="Network fee" value="≈ ₦250" />
          <Row label="Estimated time" value="~2 mins" />
          <div className="my-1 border-t border-border" />
          <Row label="You receive" value={`${to} ${toSym}`} />
        </div>
      </div>

      {/* CTA */}
      <div className="mt-6 space-y-3 px-5">
        <button
          onClick={confirm}
          disabled={processing}
          className="w-full rounded-full py-4 text-base font-bold text-white disabled:opacity-60"
          style={{ backgroundColor: "#6B5B95" }}
        >
          {processing ? "Swapping…" : "Confirm Swap"}
        </button>
        <button
          onClick={() => router.back()}
          disabled={processing}
          className="w-full rounded-full py-3 text-base font-semibold text-muted disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </AppShell>
  );
}

export default function ConfirmSwapPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmInner />
    </Suspense>
  );
}
