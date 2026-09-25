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
