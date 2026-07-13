// apps/api/src/lib/maplerad/crypto.ts
//
// Stablecoin infrastructure (replaces Tatum): per-customer deposit addresses,
// stablecoin withdrawals, and USD (FEDWIRE/ACH) accounts.
//
// ⚠️ COMPLIANCE GATE. This entire module must stay behind the crypto feature
// flag. Consolidating providers does NOT grant regulatory relief: CBN/SEC VASP
// registration and the Google Play Financial Features Declaration remain hard
// blockers before any crypto-enabled release. Every exported function calls
// `assertCryptoEnabled()` so an accidental import can't expose crypto in the
// current launch phase.
//
// Also note: Maplerad stablecoin is USDC / USDT / PYUSD only — NOT BTC. If BTC
// custody must remain, Tatum can't be fully retired (Open question O3).

import { mapleradRequest } from "./client";
import type { Minor } from "./types";

// Wire this to apps/api/src/lib/features.ts (assertFeatureEnabled('crypto')).
// Kept as a local indirection so this file has no hard import cycle.
export type FeatureGuard = () => void;

let assertCryptoEnabled: FeatureGuard = () => {
  throw new Error(
    "Crypto feature is gated. Wire assertCryptoEnabled to features.ts before use.",
  );
};

/** Call once at app init: setCryptoGuard(() => assertFeatureEnabled('crypto')). */
export function setCryptoGuard(guard: FeatureGuard): void {
  assertCryptoEnabled = guard;
}

export type Coin = "USDC" | "USDT" | "PYUSD";
export type Chain = "solana" | "base" | "polygon" | "eth" | "tron" | "bsc";

export interface DepositAddress {
  id: string;
  address: string;
  chain: string;
  coin: string;
  offramp: boolean;
  active: boolean;
}

/**
 * Generate a unique stablecoin deposit address for a customer.
 * POST /crypto
 */
export async function createDepositAddress(input: {
  customerId: string;
  coin?: Coin;
  chain?: Chain;
  offramp?: boolean; // auto-convert deposits to USD
}): Promise<DepositAddress> {
  assertCryptoEnabled();
  return mapleradRequest<DepositAddress>("/crypto", {
    method: "POST",
    body: {
      customer_id: input.customerId,
      coin: input.coin ?? "USDC",
      chain: input.chain ?? "solana",
      offramp: input.offramp ?? false,
    },
  });
}

export interface CryptoTransferResult {
  id: string;
  amount: number;
  fee: number;
  address?: string;
  chain?: string;
  coin?: string;
  currency?: string;
  status: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/**
 * Initiate a stablecoin withdrawal. Debits the USD wallet and converts to fund
 * the transfer. Confirm the beneficiary `address` carefully — irreversible.
 * POST /crypto/transfer
 */
export async function withdrawStablecoin(input: {
  amount: Minor;
  address: string;
  chain: Chain;
  coin?: Coin;
  reference?: string;
  reason?: string;
  fundingSource?: "USD";
}): Promise<CryptoTransferResult> {
  assertCryptoEnabled();
  return mapleradRequest<CryptoTransferResult>("/crypto/transfer", {
    method: "POST",
    idempotencyKey: input.reference,
    body: {
      amount: input.amount,
      address: input.address,
      chain: input.chain,
      coin: input.coin ?? "usdc",
      reference: input.reference,
      reason: input.reason,
      funding_source: input.fundingSource ?? "USD",
    },
  });
}

// ---- USD accounts (FEDWIRE / ACH) ----------------------------------------

export interface UsdAccountRequest {
  reference: string; // poll status with checkUsdAccountStatus()
  status: string; // "PENDING"
  currency: string; // "USD"
  kyc_link?: string;
}

/**
 * Request a USD virtual account for a customer. Async — returns a reference and
 * (sometimes) a KYC link; final account arrives via webhook / status polling.
 * The `meta` block carries the extended US-onboarding KYC fields.
 * POST /collections/virtual-account/usd
 */
export async function createUsdAccount(input: {
  customerId: string;
  meta: {
    identification_number: string;
    employment_status:
      | "EMPLOYED"
      | "SELF_EMPLOYED"
      | "UNEMPLOYED"
      | "STUDENT"
      | "RETIRED";
    employment_description: string;
    nationality: string;
    employer_name: string;
    occupation: string;
    us_residency_status:
      | "NON_RESIDENT_ALIEN"
      | "RESIDENT_ALIEN"
      | "US_CITIZEN";
    documents?: Record<string, unknown>;
  };
}): Promise<UsdAccountRequest> {
  assertCryptoEnabled();
  return mapleradRequest<UsdAccountRequest>(
    "/collections/virtual-account/usd",
    { method: "POST", body: { customer_id: input.customerId, meta: input.meta } },
  );
}

/**
 * Check the status of a USD account request.
 * GET /collections/virtual-account/usd/{reference}  (path inferred — confirm)
 */
export async function checkUsdAccountStatus(
  reference: string,
): Promise<Record<string, unknown>> {
  assertCryptoEnabled();
  return mapleradRequest(`/collections/virtual-account/usd/${reference}`);
}
