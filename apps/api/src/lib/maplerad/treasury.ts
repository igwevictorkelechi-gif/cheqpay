// apps/api/src/lib/maplerad/treasury.ts
//
// How much of each currency our business actually holds at Maplerad.
//
// Every user's dollars and naira are pooled in the business wallets there, and
// an FX exchange is paid out of them. When those wallets hold less than a swap
// needs, Maplerad refuses it ("insufficient balance") — after the user has
// already pressed Confirm. Reading the balance first lets us say so at quote
// time instead.

import { getWallets } from "./wallets";
import type { Wallet } from "./types";

const TTL_MS = 30_000;
let memo: { at: number; wallets: Wallet[] } | null = null;

/** Test hook: forget the cached balances. */
export function resetTreasuryCache(): void {
  memo = null;
}

/**
 * The largest available balance we hold in `currency` across our business
 * wallets, in minor units (kobo / cents). Null when it can't be read, so a
 * partner hiccup never blocks a swap on its own — the swap's refund-on-failure
 * path still protects the user.
 *
 * The largest wallet rather than the sum: an exchange draws on one wallet, and
 * using the largest means we only refuse when no wallet could cover it.
 */
export async function getProviderBalanceMinor(currency: "NGN" | "USD"): Promise<bigint | null> {
  try {
    if (!memo || Date.now() - memo.at > TTL_MS) {
      memo = { at: Date.now(), wallets: await getWallets() };
    }
    const balances = memo.wallets
      .filter((w) => w.currency === currency && w.active && !w.disabled)
      .map((w) => w.available_balance)
      .filter((b) => Number.isFinite(b));
    if (balances.length === 0) return null;
    return BigInt(Math.trunc(Math.max(...balances)));
  } catch (err) {
    console.error("[treasury] could not read business wallet balances", err);
    return null;
  }
}

/** Every business wallet balance per currency (largest wallet), for reconciliation. */
export async function getProviderBalances(): Promise<{ NGN: bigint | null; USD: bigint | null }> {
  return { NGN: await getProviderBalanceMinor("NGN"), USD: await getProviderBalanceMinor("USD") };
}
