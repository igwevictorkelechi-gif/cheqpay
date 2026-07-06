"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Landmark } from "lucide-react";
import { NairaFlag } from "@/components/MobileUI";
import { api } from "@/services/api";

export default function AddMoneyPage() {
  const router = useRouter();
  const [amount, setAmount] = useState("1000");
  const [available, setAvailable] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { balances } = await api.getBalances();
        if (!active) return;
        setAvailable(Number(balances.find((b) => b.asset === "NGN")?.availableFormatted ?? 0));
      } catch {
        /* balance is informational — ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const digits = amount.replace(/\D/g, "");
  const display = digits ? Number(digits).toLocaleString("en-NG") : "0";
  const valid = Number(digits) > 0;

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-6 pt-3">
        {/* Header */}
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-4xl font-extrabold text-ink">Add money</h1>
          <NairaFlag size={48} />
        </div>

        {/* Amount */}
        <div className="mt-6 rounded-3xl bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm text-muted">Enter amount</p>
              <input
                inputMode="numeric"
                value={display}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                className="mt-1 w-full bg-transparent text-4xl font-extrabold text-ink outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <NairaFlag size={28} />
              <span className="text-xl font-bold text-ink">NGN</span>
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted">
          Available: {available === null ? "…" : available.toLocaleString("en-NG")} NGN
        </p>

        {/* Pay with */}
        <p className="mt-8 text-base font-bold text-ink">Pay with</p>
        <div className="mt-3 flex items-center gap-4 rounded-3xl bg-card p-5">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-circle">
            <Landmark className="h-6 w-6 text-ink" />
          </span>
          <div>
            <p className="text-lg font-bold text-ink">Bank Transfer</p>
            <p className="mt-0.5 text-sm text-muted">
              Transfer to your CheqPay account. Arrives in seconds.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-auto pt-6">
          <button
            disabled={!valid}
            onClick={() => router.push(`/virtual-account?amount=${digits}`)}
            className="w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 text-base font-bold text-white shadow-lg shadow-brand/30 active:scale-[0.98] disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
