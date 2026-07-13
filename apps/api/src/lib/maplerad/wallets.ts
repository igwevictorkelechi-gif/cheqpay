// apps/api/src/lib/maplerad/wallets.ts
//
// Business-wallet reads and inter-wallet funding. These are YOUR float
// balances (TREASURY / SPEND), not per-customer balances — Cheqpay's own
// ledger tracks user balances and is reconciled against these.

import { mapleradRequest } from "./client";
import type { Minor, Wallet, WalletType } from "./types";

/**
 * List business wallets, optionally filtered by type.
 * Balances are in minor units (kobo / cents).
 *
 * GET /wallets?wallet_type=TREASURY|SPEND
 */
export async function getWallets(walletType?: WalletType): Promise<Wallet[]> {
  return mapleradRequest<Wallet[]>("/wallets", {
    query: walletType ? { wallet_type: walletType } : undefined,
  });
}

/** Convenience: the first active wallet for a currency + type. */
export async function getWallet(
  currency: Wallet["currency"],
  walletType: WalletType = "TREASURY",
): Promise<Wallet | undefined> {
  const wallets = await getWallets(walletType);
  return wallets.find((w) => w.currency === currency && w.active && !w.disabled);
}

/**
 * Move funds between wallet types, e.g. SPEND -> TREASURY, to fund card spend.
 *
 * POST /wallets/funding
 */
export async function fundWallet(input: {
  amount: Minor;
  currency: Wallet["currency"];
  source: WalletType;
  destination: WalletType;
  reference?: string;
}): Promise<unknown> {
  return mapleradRequest<unknown>("/wallets/funding", {
    method: "POST",
    body: {
      amount: input.amount,
      currency: input.currency,
      source_wallet: input.source,
      destination_wallet: input.destination,
      reference: input.reference,
    },
    idempotencyKey: input.reference,
  });
}
