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

/** A bank the PSP can pay out to / resolve against (NG). */
export interface Bank {
  code: string;
  name: string;
}

/** Create-virtual-account request. `bvn` (11 digits) is required by
 *  Flutterwave to mint a PERMANENT (dedicated) NUBAN; without it we mint a
 *  temporary/static account. */
export interface CreateVirtualAccountInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  bvn?: string;
  permanent: boolean;
  /** Our unique reference for the account request. */
  txRef: string;
  narration?: string;
}

export interface VirtualAccountResult {
  accountNumber: string;
  bankName: string;
  bankCode?: string;
  providerRef: string;
  permanent: boolean;
}

export interface ResolveAccountInput {
  accountNumber: string;
  bankCode: string;
}
export interface ResolveAccountResult {
  accountName: string;
}

export interface BillValidateInput {
  flwBillerCode?: string;
  flwItemCode?: string;
  customer: string;
}
export interface BillValidateResult {
  valid: boolean;
  customerName?: string;
}

export interface BillPayInput {
  service: string; // airtime | data | electricity | cabletv | betting
  flwType: string; // Flutterwave bill `type`
  flwBillerCode?: string;
  flwItemCode?: string;
  customer: string;
  amount: string; // NGN decimal string
  reference: string;
}
export interface BillPayResult {
  providerRef: string;
  status: "successful" | "pending" | "failed";
  /** Prepaid token / recharge PIN (e.g. electricity meter token), if issued. */
  token?: string | null;
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

  /** Create a dedicated/temporary NUBAN the user funds by bank transfer. */
  createVirtualAccount(input: CreateVirtualAccountInput): Promise<VirtualAccountResult>;

  /** Resolve the account holder's name for a NUBAN + bank code. */
  resolveBankAccount(input: ResolveAccountInput): Promise<ResolveAccountResult>;

  /** List NG banks available for payouts / resolution. */
  listBanks(): Promise<Bank[]>;

  /** Validate a bill customer (e.g. meter/smartcard), returning the name. */
  validateBillCustomer(input: BillValidateInput): Promise<BillValidateResult>;

  /** Pay a bill (airtime, data, electricity, cable TV, betting). */
  payBill(input: BillPayInput): Promise<BillPayResult>;
}
