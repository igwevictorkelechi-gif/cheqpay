"use client";

// The fees the admin sets, as the user sees them before confirming.
//
// These mirror the server exactly (apps/api/src/lib/fees.ts): the withdrawal
// fee comes out of the amount withdrawn, so the balance drops by exactly what
// the user typed and the bank receives the rest. The server applies the same
// rule, so what the screen shows is what gets paid.

import { useEffect, useState } from "react";
import { api, type PublicFees, type PublicLimits } from "@/services/api";

let cached: Promise<PublicLimits | null> | null = null;
let cachedAt = 0;
/** Short, so a fee changed in the admin reaches an open app within a minute. */
const CACHE_MS = 60_000;

/**
 * The minimums and fees set in the admin dashboard, fetched once per page load.
 * Null while loading or if unavailable — screens fall back to "fee shown at
 * confirmation" rather than guessing a number.
 */
export function useLimits(): PublicLimits | null {
  const [limits, setLimits] = useState<PublicLimits | null>(null);
  useEffect(() => {
    let active = true;
    if (!cached || Date.now() - cachedAt > CACHE_MS) {
      cachedAt = Date.now();
      cached = api.getLimits().catch(() => {
        cached = null; // allow a retry on the next screen
        return null;
      });
    }
    void cached.then((l) => {
      if (active) setLimits(l);
    });
    return () => {
      active = false;
    };
  }, []);
  return limits;
}

/** Just the fees. */
export function useFees(): PublicFees | null {
  return useLimits()?.fees ?? null;
}

export interface WithdrawalBreakdown {
  /** What leaves the balance — the amount typed. */
  amount: number;
  fee: number;
  /** What the bank account receives. */
  receive: number;
  /** False when the amount doesn't cover the fee. */
  ok: boolean;
}

/** Naira in, naira out. Rounded to kobo so floats never show 99,799.99999. */
export function withdrawalBreakdown(amountNgn: number, feeNgn: number): WithdrawalBreakdown {
  const toKobo = (n: number) => Math.round(n * 100);
  const amount = toKobo(amountNgn);
  const fee = toKobo(Math.max(0, feeNgn));
  const receive = amount - fee;
  return { amount: amount / 100, fee: fee / 100, receive: Math.max(0, receive) / 100, ok: amount > 0 && receive > 0 };
}

/** "₦100,000" or "₦99,800.50" — kobo shown only when there are any. */
export function naira(n: number): string {
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** "0.5%" from 50 basis points; "1%" from 100. */
export function percent(bps: number): string {
  return `${(bps / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}%`;
}

/** "$3" or "$1.50". */
export function dollars(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** "0.75% (max ₦800)" — the Naira deposit fee as users should read it. */
export function ngnDepositFeeText(f: PublicFees): string {
  if (f.depositFeeBps <= 0) return "Free";
  return f.depositFeeCapNgn > 0
    ? `${percent(f.depositFeeBps)} (max ${naira(f.depositFeeCapNgn)})`
    : percent(f.depositFeeBps);
}

/** "3.5% · 2% from $25,000" — the USD bank deposit fee. */
export function usdDepositFeeText(f: PublicFees): string {
  if (f.usdDepositFeeBps <= 0 && f.usdDepositLargeFeeBps <= 0) return "Free";
  return `${percent(f.usdDepositFeeBps)} · ${percent(f.usdDepositLargeFeeBps)} from ${dollars(f.usdDepositLargeThresholdUsd)}`;
}

/** "$1.50 under $100 · 2.5% from $100" — the card top-up fee. */
export function cardFundFeeText(f: PublicFees): string {
  return `${dollars(f.cardFundFeeSmallUsd)} under ${dollars(f.cardFundThresholdUsd)} · ${percent(f.cardFundFeeLargeBps)} from ${dollars(f.cardFundThresholdUsd)}`;
}

/**
 * A card top-up: the card gets the amount, the fee is added on top, and the
 * wallet pays the total. Mirrors cardFundFee on the server, in cents.
 */
export function cardFundBreakdown(amountUsd: number, f: PublicFees): {
  amount: number;
  fee: number;
  total: number;
  belowMin: boolean;
} {
  const cents = Math.round(amountUsd * 100);
  const belowMin = cents < Math.round(f.cardFundMinUsd * 100);
  const feeCents =
    cents >= Math.round(f.cardFundThresholdUsd * 100)
      ? Math.floor((cents * f.cardFundFeeLargeBps) / 10_000)
      : Math.round(f.cardFundFeeSmallUsd * 100);
  return { amount: cents / 100, fee: feeCents / 100, total: (cents + feeCents) / 100, belowMin };
}

/**
 * The crypto network fee in coin, at the coin"s USD price, rounded up to the
 * coin"s precision the way the server does. Null without a price.
 */
export function cryptoFeeInCoin(feeUsd: number, usdPrice: number | null, decimals: number): number | null {
  if (feeUsd <= 0) return 0;
  if (!usdPrice || usdPrice <= 0) return null;
  const f = 10 ** decimals;
  return Math.ceil((feeUsd / usdPrice) * f) / f;
}

export interface PriceRow {
  what: string;
  price: string;
  note?: string;
}

/**
 * Every fee a user can be charged, as plain text: the source for the Pricing
 * page on both apps. Built from the live admin values, so it cannot drift.
 */
export function priceSheet(f: PublicFees): { title: string; rows: PriceRow[] }[] {
  const billRate = (bps: number) => (bps > 0 ? `${percent(bps)} on top` : "No fee");
  return [
    {
      title: "Adding money",
      rows: [
        { what: "Naira deposit (bank transfer)", price: ngnDepositFeeText(f), note: "Taken from the amount received." },
        { what: "USD deposit (ACH / wire)", price: usdDepositFeeText(f), note: "Taken from the amount received." },
        { what: "Stablecoin deposit credited as USD", price: f.cryptoDepositFeeBps > 0 ? percent(f.cryptoDepositFeeBps) : "Free" },
        { what: "Crypto deposit credited as the coin", price: "Free" },
      ],
    },
    {
      title: "Sending money out",
      rows: [
        { what: "Withdrawal to a Nigerian bank", price: f.withdrawalFeeNgn > 0 ? naira(f.withdrawalFeeNgn) : "Free", note: "Taken from the amount you withdraw." },
        { what: "Crypto withdrawal (network fee)", price: f.cryptoWithdrawalFeeUsd > 0 ? `${dollars(f.cryptoWithdrawalFeeUsd)} in the coin` : "Free", note: "Taken from the amount you send, at the live price." },
        { what: "Send to another CheqPay user", price: "Free" },
      ],
    },
    {
      title: "Converting",
      rows: [
        { what: "Naira → Dollar", price: percent(f.fx.sellUsdBps), note: "Included in the rate you see before confirming." },
        { what: "Dollar → Naira", price: percent(f.fx.buyUsdBps), note: "Included in the rate you see before confirming." },
        { what: "Buy, sell or convert crypto", price: percent(f.swapSpreadBps), note: "Included in the rate you see before confirming." },
      ],
    },
    {
      title: "USD virtual card",
      rows: [
        { what: "New card", price: dollars(f.cardIssueFeeUsd), note: "Paid from your USD balance." },
        { what: "Top up the card", price: cardFundFeeText(f), note: `Added on top. Smallest top-up ${dollars(f.cardFundMinUsd)}.` },
        { what: "Move money off the card", price: dollars(f.cardWithdrawFeeUsd), note: "Taken from the amount moved." },
        { what: "Spending in another currency or abroad", price: "2.5% + $0.50", note: "Charged by the card network." },
        { what: "Declined or unsettled card payment", price: "$0.50", note: "Charged by the card network." },
        { what: "Chargeback (disputing a card payment)", price: "$45", note: "Charged by the card network." },
      ],
    },
    {
      title: "Bills",
      rows: [
        { what: "Airtime", price: billRate(f.bills.airtime) },
        { what: "Data", price: billRate(f.bills.data) },
        { what: "Electricity", price: billRate(f.bills.electricity) },
        { what: "Cable TV", price: billRate(f.bills.cabletv) },
        { what: "Betting wallet top-up", price: billRate(f.bills.betting) },
      ],
    },
  ];
}

/**
 * What a deposit of `amount` will credit, after its fee. Mirrors the server"s
 * ngnDepositFee / usdDepositFee, rounded to the minor unit.
 */
export function depositBreakdown(amount: number, currency: "NGN" | "USD", f: PublicFees): {
  fee: number;
  receive: number;
} {
  const minor = Math.round(amount * 100);
  let feeMinor: number;
  if (currency === "NGN") {
    feeMinor = Math.floor((minor * f.depositFeeBps) / 10_000);
    const cap = Math.round(f.depositFeeCapNgn * 100);
    if (cap > 0 && feeMinor > cap) feeMinor = cap;
  } else {
    const large = minor >= Math.round(f.usdDepositLargeThresholdUsd * 100);
    feeMinor = Math.floor((minor * (large ? f.usdDepositLargeFeeBps : f.usdDepositFeeBps)) / 10_000);
  }
  return { fee: feeMinor / 100, receive: (minor - feeMinor) / 100 };
}
