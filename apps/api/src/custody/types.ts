import type { Asset, Network } from "@cheqpay/db";

/** A provisioned on-chain deposit address backed by a custody virtual account. */
export interface DepositAddress {
  address: string;
  custodyRef: string; // provider virtual-account / account id
}

/** A normalized inbound deposit parsed from a provider webhook. */
export interface IncomingDeposit {
  /** Provider-unique event id (for idempotency / replay protection). */
  eventId: string;
  address: string;
  asset: Asset;
  network: Network;
  /** Human decimal string (e.g. "0.0125"); converted to minor units downstream. */
  amount: string;
  txHash: string;
}

/**
 * Custody abstraction. The provider holds keys (HSM) and signs; our backend
 * never touches private keys — we store only the returned `custodyRef` and
 * public address. Swappable: Tatum (primary), or a mock for dev/tests.
 */
export interface CustodyProvider {
  readonly name: string;

  /** Provision (or fetch) a deposit address for a user/asset/network. */
  createDepositAddress(input: {
    userId: string;
    asset: Asset;
    network: Network;
  }): Promise<DepositAddress>;

  /** Verify a webhook's signature against the raw request body. */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;

  /** Parse a verified webhook body into a normalized deposit, or null if N/A. */
  parseDepositEvent(payload: unknown): IncomingDeposit | null;
}
