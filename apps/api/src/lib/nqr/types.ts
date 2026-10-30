// Cross-bank QR (Nigeria's NQR standard) — provider contract.
//
// NQR is NIBSS's EMVCo-based QR: a code any participating bank app (OPay,
// Kuda, GTBank, …) can scan and be taken into its own "send money" flow. Making
// that work needs two things this codebase CANNOT provide on its own:
//   1. a provider/aggregator (a NIBSS-licensed PTSP) that mints NQR payloads;
//   2. each receiving Naira account registered as an NQR (sub-)merchant there.
//
// So this package is scaffolding: a stable interface, plus a mock that produces
// a *structurally* valid EMVCo string for tests and the pentest lab. The
// `nqr_payments` feature flag stays OFF until a real provider implements this
// interface and merchants are registered — see lib/features.ts. Nothing in the
// shipped app calls a real provider yet.

export interface NqrMerchant {
  /** The user's Naira account number (NUBAN). */
  accountNumber: string;
  /** The account's bank code, where the provider needs it. */
  bankCode?: string;
  /** Shown to the payer in their bank app. */
  merchantName: string;
}

export interface NqrPayloadInput {
  /** The id returned by registerMerchant. */
  merchantId: string;
  /** Optional fixed amount in kobo; omitted = the payer types the amount. */
  amountMinor?: bigint;
  /** Optional reference echoed back on settlement. */
  reference?: string;
}

export interface NqrProvider {
  /** Short identifier, e.g. "mock" or the aggregator's name. */
  readonly name: string;
  /** Whether this provider can actually settle against real bank apps. */
  readonly live: boolean;
  /** Register (idempotently) a Naira account as an NQR merchant. */
  registerMerchant(merchant: NqrMerchant): Promise<{ merchantId: string }>;
  /** Build the EMVCo/NQR string a bank app scans. */
  generatePayload(input: NqrPayloadInput): Promise<string>;
}
