/**
 * Naira payment-rail abstraction (PSP). Maplerad is the live rail; MockPaymentProvider
 * stands in for local dev and tests. Amounts crossing this boundary are human
 * decimal strings in NGN; each provider converts to minor units (kobo) itself.
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
  /** The provider's exact biller identifier (see lib/bills.ts `mapleradId`). */
  billerCode?: string;
  customer: string;
}
export interface BillValidateResult {
  valid: boolean;
  customerName?: string;
}

export interface BillPayInput {
  service: string; // airtime | data | electricity | cabletv
  /** The provider's exact biller identifier (see lib/bills.ts `mapleradId`). */
  billerCode?: string;
  /**
   * The provider's own plan code, taken from listBillPlans — a data bundle code
   * or a cable subscription id. Fixed-price services (data, cable) send this so
   * the exact plan the user saw is the one bought; without it the provider would
   * have to guess from the price, which is how you sell someone the wrong bundle.
   */
  planCode?: string;
  customer: string;
  amount: string; // NGN decimal string
  reference: string;
}

/** A plan the provider actually sells today, priced in minor units (kobo). */
export interface ProviderBillPlan {
  /** The provider's own code — passed back verbatim as BillPayInput.planCode. */
  code: string;
  name: string;
  amountMinor: number;
}
export interface BillPayResult {
  providerRef: string;
  status: "successful" | "pending" | "failed";
  /** Prepaid token / recharge PIN (e.g. electricity meter token), if issued. */
  token?: string | null;
}

/**
 * Raised when a bill payment is rejected by the PSP. `providerMessage` carries
 * the PSP's own human-readable reason (safe to surface to the user — it never
 * contains credentials) so the app can explain *why* a payment failed instead
 * of a generic error.
 */
export class BillPaymentError extends Error {
  constructor(
    message: string,
    public readonly providerMessage?: string,
    public readonly providerStatus?: number
  ) {
    super(message);
    this.name = "BillPaymentError";
  }
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

  /**
   * The plans a biller currently sells (data bundles, cable bouquets), straight
   * from the provider. Optional: a provider that publishes no plan list simply
   * omits it and the catalog falls back to its static plans.
   *
   * This is what keeps the catalog honest. Plan prices used to be hardcoded and
   * matched by price at purchase, so any drift between our list and the
   * provider's made the plan unbuyable.
   */
  listBillPlans?(
    service: "data" | "cabletv",
    billerCode: string
  ): Promise<ProviderBillPlan[]>;
}
