"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Landmark, Loader2, ShieldAlert } from "lucide-react";
import { NairaFlag } from "@/components/MobileUI";
import { api, type UsdAccount } from "@/services/api";
import DesktopSidebar from "@/components/DesktopSidebar";

/** `?currency=USD` puts the screen in dollar mode; anything else is Naira. */
function currencyFromQuery(): "NGN" | "USD" {
  if (typeof window === "undefined") return "NGN";
  const raw = new URLSearchParams(window.location.search).get("currency");
  return raw?.toUpperCase() === "USD" ? "USD" : "NGN";
}

/** A USD account can exist but still be in review — only an approved one can receive. */
function isUsable(account: UsdAccount | null): boolean {
  if (!account) return false;
  if (account.consentRequired) return false;
  // No status at all is treated as usable: older accounts predate status
  // tracking, and blocking them would lock out users who can already receive.
  if (!account.status) return true;
  return /approv|active|success/i.test(account.status);
}

export default function AddMoneyPage() {
  const router = useRouter();
  const [currency, setCurrency] = useState<"NGN" | "USD">("NGN");
  const [amount, setAmount] = useState("1000");
  const [available, setAvailable] = useState<number | null>(null);
  // USD only: null while we are still checking whether the account exists.
  const [usdAccount, setUsdAccount] = useState<UsdAccount | null>(null);
  const [checkingUsd, setCheckingUsd] = useState(false);

  useEffect(() => {
    let active = true;
    const c = currencyFromQuery();
    setCurrency(c);
    if (c === "USD") setCheckingUsd(true);

    (async () => {
      try {
        const [{ balances }, usd] = await Promise.all([
          api.getBalances(),
          c === "USD" ? api.getUsdAccount().catch(() => ({ usdAccount: null })) : Promise.resolve(null),
        ]);
        if (!active) return;
        setAvailable(Number(balances.find((b) => b.asset === c)?.availableFormatted ?? 0));
        if (usd) setUsdAccount(usd.usdAccount);
      } catch {
        /* balance is informational — ignore */
      } finally {
        if (active) setCheckingUsd(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const isUsd = currency === "USD";
  const symbol = isUsd ? "$" : "₦";
  const locale = isUsd ? "en-US" : "en-NG";
  const digits = amount.replace(/\D/g, "");
  const display = digits ? Number(digits).toLocaleString(locale) : "0";
  const valid = Number(digits) > 0;
  // Dollars can only be received once the USD account is open and approved.
  const blocked = isUsd && !checkingUsd && !isUsable(usdAccount);

  return (
    <div className="flex min-h-screen justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-6 pt-3 lg:max-w-3xl">
        {/* Header */}
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-4xl font-extrabold text-ink">
            {isUsd ? "Add dollars" : "Add money"}
          </h1>
          {isUsd ? (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 text-2xl font-bold text-green-500">
              $
            </span>
          ) : (
            <NairaFlag size={48} />
          )}
        </div>

        {checkingUsd ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted" />
          </div>
        ) : blocked ? (
          // ---- USD account not open (or still in review) ----
          <>
            <div className="mt-8 flex flex-col items-center rounded-3xl bg-card p-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15">
                <ShieldAlert className="h-7 w-7 text-amber-400" />
              </span>
              <h2 className="mt-4 text-xl font-extrabold text-ink">
                {usdAccount ? "Your dollar account is being verified" : "Verify your dollar account"}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {usdAccount
                  ? "We’re reviewing your details. You’ll be able to receive dollars as soon as it’s approved — check the status on your account page."
                  : "A dollar account needs a few extra details for US banking compliance before it can receive money. It only takes a minute."}
              </p>
            </div>

            <div className="mt-auto pt-6">
              <button
                onClick={() => router.push("/virtual-account")}
                className="w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 text-base font-bold text-white shadow-lg shadow-brand/30 active:scale-[0.98]"
              >
                {usdAccount ? "Check status" : "Verify my dollar account"}
              </button>
            </div>
          </>
        ) : (
          <>
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
                  {isUsd ? (
                    <span className="text-xl font-bold text-green-500">{symbol}</span>
                  ) : (
                    <NairaFlag size={28} />
                  )}
                  <span className="text-xl font-bold text-ink">{currency}</span>
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">
              Available: {available === null ? "…" : available.toLocaleString(locale)} {currency}
            </p>

            {/* Pay with */}
            <p className="mt-8 text-base font-bold text-ink">Pay with</p>
            <div className="mt-3 flex items-center gap-4 rounded-3xl bg-card p-5">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-circle">
                <Landmark className="h-6 w-6 text-ink" />
              </span>
              <div>
                <p className="text-lg font-bold text-ink">
                  {isUsd ? "Bank / wire transfer" : "Bank Transfer"}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {isUsd
                    ? "Send dollars to your account details from anywhere."
                    : "Transfer to your CheqPay account. Arrives in seconds."}
                </p>
              </div>
            </div>

            {/* CTA */}
            <div className="mt-auto pt-6">
              <button
                disabled={!valid}
                onClick={() =>
                  router.push(
                    isUsd ? "/virtual-account" : `/virtual-account?amount=${digits}`
                  )
                }
                className="w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 text-base font-bold text-white shadow-lg shadow-brand/30 active:scale-[0.98] disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
