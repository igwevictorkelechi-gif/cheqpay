"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import AppShell from "@/components/AppShell";
import { CoinBadge } from "@/components/MobileUI";

function SuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "0.75";
  const to = params.get("to") || "22.85";
  const fromSym = params.get("fromSym") || "BTC";
  const toSym = params.get("toSym") || "ETH";

  return (
    <AppShell>
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        {/* Success check */}
        <div
          className="flex h-24 w-24 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(52,199,89,0.15)" }}
        >
          <span
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: "#34C759" }}
          >
            <Check className="h-9 w-9 text-white" strokeWidth={3} />
          </span>
        </div>

        <h1 className="mt-6 text-2xl font-extrabold text-ink">Swap Successful</h1>
        <p className="mt-2 text-sm text-muted">
          You swapped {from} {fromSym} for {to} {toSym}
        </p>

        {/* Summary */}
        <div className="mt-6 w-full rounded-3xl bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CoinBadge symbol={fromSym} size={36} />
              <span className="font-bold text-ink">
                {from} {fromSym}
              </span>
            </div>
            <span className="text-muted">→</span>
            <div className="flex items-center gap-2">
              <CoinBadge symbol={toSym} size={36} />
              <span className="font-bold text-ink">
                {to} {toSym}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-2 space-y-3 px-5 pb-2">
        <button
          onClick={() => router.push("/transactions")}
          className="w-full rounded-full py-4 text-base font-bold text-white"
          style={{ backgroundColor: "#6B5B95" }}
        >
          View transaction history
        </button>
        <button
          onClick={() => router.push("/crypto")}
          className="w-full rounded-full py-3 text-base font-semibold text-muted"
        >
          Done
        </button>
      </div>
    </AppShell>
  );
}

export default function SwapSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  );
}
