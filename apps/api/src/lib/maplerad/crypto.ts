// apps/api/src/lib/maplerad/crypto.ts
//
// Stablecoin infrastructure: per-customer deposit addresses,
// stablecoin withdrawals, and USD (FEDWIRE/ACH) accounts.
//
// ⚠️ COMPLIANCE GATE. This entire module must stay behind the crypto feature
// flag. Consolidating providers does NOT grant regulatory relief: CBN/SEC VASP
// registration and the Google Play Financial Features Declaration remain hard
// blockers before any crypto-enabled release. Every exported function calls
// `assertCryptoEnabled()` so an accidental import can't expose crypto in the
// current launch phase.
//
// Also note: Maplerad stablecoin is USDC / USDT / PYUSD only — NOT BTC. BTC
// stays "coming soon" until a BTC custodian is wired.

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

/**
 * Coin casing differs between the two crypto endpoints and Maplerad validates
 * against the enum literally, so this is not cosmetic:
 *   POST /crypto           enum ["USDC","USDT","PYUSD"]  (upper)
 *   POST /crypto/transfer  enum ["usdc","usdt","pyusd"]  (lower)
 * We keep one upper-case type and lower-case it at the transfer boundary.
 */
export type Coin = "USDC" | "USDT" | "PYUSD";

/** Chains POST /crypto will mint a deposit address on. */
export type Chain = "solana" | "base" | "polygon" | "eth" | "tron" | "bsc";

/**
 * Chains POST /crypto/transfer will withdraw to — per its OpenAPI definition,
 * `solana` and nothing else, while address generation accepts six.
 *
 * That asymmetry is a money trap, not a curiosity: an address minted on a chain
 * this list excludes can receive funds that have no documented way out. Anything
 * that mints addresses must therefore refuse chains that are missing from here
 * (see custody/maplerad.ts), and this type must not be widened without a real
 * sandbox withdrawal proving the chain is accepted.
 */
export type TransferChain = "solana";

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
      // `offramp`, not `off_ramp`. Maplerad's own documentation disagrees with
      // itself here: the request schema names the property `offramp` and the
      // response returns `offramp`, but the worked "Request Example" beside it
      // sends `off_ramp`. Two of three say offramp, including the machine-
      // readable half, so that is what goes on the wire. Do not "correct" this
      // to match the example without testing what actually gets honoured —
      // silently sending the wrong name means offramp defaults to false and
      // deposits stop converting to USD, with nothing failing loudly.
      offramp: input.offramp ?? false,
    },
  });
}

/**
 * The transfer response, covering both shapes Maplerad documents for it — the
 * worked example returns `address` / `chain` / `hash`, while the response schema
 * printed directly beneath it returns `to_address` / `to_chain` / `from_address`
 * / `blockchain_memo` and no hash at all. Every field beyond `id` and `status`
 * is therefore optional here; read them defensively rather than assuming either
 * half of the documentation won.
 */
export interface CryptoTransferResult {
  id: string;
  amount: number;
  fee: number;
  /** Per the worked example. */
  address?: string;
  chain?: string;
  hash?: string;
  coin?: string;
  /** Per the response schema. */
  to_address?: string;
  to_chain?: string;
  from_address?: string;
  blockchain_memo?: string;
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
 *
 * `chain` is TransferChain, not Chain: this endpoint documents a narrower set
 * than address generation. See the TransferChain doc comment.
 */
export async function withdrawStablecoin(input: {
  amount: Minor;
  address: string;
  chain: TransferChain;
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
      // Lower-cased deliberately — this endpoint's enum is lower-case while
      // POST /crypto's is upper-case, and Coin carries the upper-case spelling.
      coin: (input.coin ?? "USDC").toLowerCase(),
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
