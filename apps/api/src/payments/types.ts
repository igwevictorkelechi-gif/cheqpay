/**
 * Naira payment-rail abstraction (PSP). Flutterwave is primary; Paystack slots
 * in behind the same interface as the swappable secondary. Amounts crossing
 * this boundary are human decimal strings in NGN; they're converted to minor
 * units (kobo) on our side.
 */

export interface NgnChargeEvent {
  /** Provider-unique id for idempotency/replay. */
  eventId: string;
  /** Our transaction reference echoed back by the PSP. */
  txRef: string;
  amount: string; // NGN, decimal string
  currency: string;
  status: "successful" | "failed" | "pending";
  customerEmail?: string;
}

export interface NgnTransferEvent {
  eventId: string;
  /** Our reference passed to initiateTransfer (we use the transaction id). */
  reference: string;
  status: "successful" | "failed" | "pending";
}

export interface TransferResult {
  providerRef: string;
  status: "new" | "pending" | "successful" | "failed";
}

export interface PaymentProvider {
  readonly name: string;

  /** Verify a PSP webhook against the raw body + signature header. */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;

  /** Parse an inbound deposit/charge event, or null if not one. */
  parseChargeEvent(payload: unknown): NgnChargeEvent | null;

  /** Parse a bank-payout status event, or null if not one. */
  parseTransferEvent(payload: unknown): NgnTransferEvent | null;

  /** Initiate a bank payout (NGN). The PSP signs/sends; status arrives by webhook. */
  initiateTransfer(input: {
    amount: string; // NGN decimal string
    bankCode: string;
    accountNumber: string;
    reference: string;
    narration?: string;
  }): Promise<TransferResult>;
}
