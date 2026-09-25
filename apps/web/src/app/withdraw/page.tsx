"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Landmark } from "lucide-react";
import { NairaFlag } from "@/components/MobileUI";
import { api } from "@/services/api";
import DesktopSidebar from "@/components/DesktopSidebar";
import { naira, useLimits, withdrawalBreakdown } from "@/lib/fees";

/** Keep digits and one decimal point with at most two places (kobo). */
function cleanAmount(raw: string): string {
  const s = raw.replace(/[^\d.]/g, "");
  const [whole, ...rest] = s.split(".");
  const w = whole.replace(/^0+(?=\d)/, "");
  return rest.length ? `${w || "0"}.${rest.join("").slice(0, 2)}` : w;
}

/** "123456.7" → "123,456.7" — grouped while typing, decimals left as typed. */
function displayAmount(a: string): string {
  if (!a) return "";
  const [whole, dec] = a.split(".");
  const grouped = Number(whole || "0").toLocaleString("en-NG");
  return dec !== undefined ? `${grouped}.${dec}` : grouped;
}

export default function WithdrawAmountPage() {
  const router = useRouter();
  const limits = useLimits();
  const [amount, setAmount] = useState("");
  // The exact balance string from the server ("123456.78"), so Max never loses a
  // kobo to floating-point rounding.
  const [availableExact, setAvailableExact] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { balances } = await api.getBalances();
        if (!active) return;
        setAvailableExact(balances.find((b) => b.asset === "NGN")?.availableFormatted ?? "0");
      } catch {
        /* informational */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const available = availableExact === null ? null : Number(availableExact);
  const value = Number(amount || "0");
  const feeNgn = limits?.fees.withdrawalFeeNgn ?? 0;
  const minNgn = limits?.withdrawal.minNgn ?? 0;
  const breakdown = withdrawalBreakdown(value, feeNgn);

  const overBalance = available !== null && value > available;
  const belowMin = value > 0 && minNgn > 0 && value < minNgn;
  const belowFee = value > 0 && !breakdown.ok;
  const valid = value > 0 && !overBalance && !belowMin && !belowFee && limits !== null;

  const message = overBalance
    ? "Amount exceeds your available balance"
    : belowMin
      ? `The smallest withdrawal is ${naira(minNgn)}`
      : belowFee
        ? `That doesn't cover the ${naira(feeNgn)} fee`
        : null;

  return (
    <div className="flex min-h-screen justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-6 pt-3 lg:max-w-3xl">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-4xl font-extrabold text-ink">Withdraw</h1>
          <NairaFlag size={48} />
        </div>

        {/* Amount */}
        <div className="mt-6 rounded-3xl bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">Enter amount</p>
              <input
                inputMode="decimal"
                placeholder="0"
                value={displayAmount(amount)}
                onChange={(e) => setAmount(cleanAmount(e.target.value))}
                className="mt-1 w-full bg-transparent text-4xl font-extrabold text-ink outline-none placeholder:text-muted"
              />
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <NairaFlag size={28} />
                <span className="text-xl font-bold text-ink">NGN</span>
              </div>
              <button
                type="button"
                disabled={!availableExact || available === 0}
                onClick={() => availableExact && setAmount(cleanAmount(availableExact))}
                className="rounded-full bg-brand/20 px-3 py-1 text-xs font-bold text-brand-light active:scale-95 disabled:opacity-40"
              >
                MAX
              </button>
            </div>
          </div>
        </div>
        <p className={`mt-3 text-sm ${message ? "text-red-400" : "text-muted"}`}>
          {message ?? `Available: ${available === null ? "…" : naira(available)}`}
        </p>

        {/* What they'll actually get — shown as they type, not after. */}
        {value > 0 && breakdown.ok && limits !== null ? (
          <div className="mt-4 space-y-2 rounded-2xl border border-border p-4 text-sm">
            <div className="flex justify-between text-muted">
              <span>Fee</span>
              <span>{feeNgn > 0 ? `−${naira(breakdown.fee)}` : "Free"}</span>
            </div>
            <div className="flex justify-between font-bold text-ink">
              <span>You&apos;ll receive</span>
              <span>{naira(breakdown.receive)}</span>
            </div>
          </div>
        ) : null}

        {/* Withdraw to */}
        <p className="mt-8 text-base font-bold text-ink">Withdraw to</p>
        <div className="mt-3 flex items-center gap-4 rounded-3xl bg-card p-5">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-circle">
            <Landmark className="h-6 w-6 text-ink" />
          </span>
          <div>
            <p className="text-lg font-bold text-ink">Bank Account</p>
            <p className="mt-0.5 text-sm text-muted">
              {limits === null ? "…" : feeNgn > 0 ? `${naira(feeNgn)} fee` : "No fee"} · Arrives in seconds
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-auto pt-6">
          <button
            disabled={!valid}
            onClick={() => router.push(`/withdraw/beneficiary?amount=${encodeURIComponent(amount)}`)}
            className="w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 text-base font-bold text-white shadow-lg shadow-brand/30 active:scale-[0.98] disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
