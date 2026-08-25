// apps/api/src/lib/maplerad/types.ts
//
// Shared types for the Maplerad integration.
// All monetary values crossing the Maplerad boundary are in the lowest
// denomination (kobo for NGN, cents for USD). We brand them so a plain
// number (naira) can never be passed where minor units are expected.

/** Integer amount in the lowest currency denomination (kobo / cents). */
export type Minor = number & { readonly __brand: "Minor" };

/** Assert/convert a raw integer as minor units. Throws on non-integer input. */
export function minor(value: number): Minor {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Minor units must be an integer, got ${value}`);
  }
  return value as Minor;
}

/** Convert a naira (major-unit) value to kobo. */
export function nairaToKobo(naira: number): Minor {
  return minor(Math.round(naira * 100));
}

export type Currency =
  | "NGN"
  | "USD"
  | "USDC"
  | "USDT"
  | "GHS"
  | "KES"
  | "XAF"
  | "XOF";

export type WalletType = "TREASURY" | "SPEND";

/** Envelope every Maplerad JSON response is wrapped in. */
export interface MapleradEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

// ---- Customers ------------------------------------------------------------

export type IdentityType =
  | "NIN"
  | "PASSPORT"
  | "VOTERS_CARD"
  | "DRIVERS_LICENSE";

/**
 * POST /identity/bvn — what the BVN registry holds for a number.
 *
 * `image` is a base64 passport photograph from the registry. It is deliberately
 * not persisted anywhere: it is biometric PII we have no need for, and storing
 * it would widen the blast radius of a database breach for no benefit.
 */
export interface BvnLookup {
  first_name: string;
  last_name: string;
  middle_name?: string;
  gender?: string;
  dob?: string; // YYYY-MM-DD
  phone_number?: string;
  image?: string; // base64 photo — do not store
}

/** POST /customers — everything Maplerad needs to open a tier 0 customer. */
export interface CreateCustomerInput {
  first_name: string;
  last_name: string;
  email: string;
  country: string; // "NG"
}

/**
 * POST /customers/enroll — the full, single-call enrollment. Unlike
 * CreateCustomerInput (tier 0), this carries the complete identity and returns a
 * customer with access to all Maplerad resources including Issuing. Used only
 * when we hold every required field; otherwise we fall back to the tier 0 create
 * plus a later tier 1 upgrade. See createCustomer/enrollCustomer in customers.ts.
 *
 * `identity` (a government ID document) and `photo` (a selfie) are optional in
 * the API and unused here — this app has no document upload, so enrollment is
 * BVN-only, exactly as the tier 1 upgrade path is.
 */
export interface EnrollCustomerInput {
  first_name: string;
  last_name: string;
  email: string;
  country: string; // "NG"
  identification_number: string; // BVN for Nigeria
  dob: string; // "DD-MM-YYYY"
  phone: { phone_country_code: string; phone_number: string };
  address: {
    street: string;
    street2?: string;
    city: string;
    state: string;
    country: string;
    postal_code: string;
  };
  identity?: {
    type: "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE";
    image: string; // URL to the uploaded document
    number: string;
    country: string;
  };
  photo?: string; // URL to a selfie image
}

/**
 * PATCH /customers/upgrade/tier1 — the identity evidence that lifts a tier 0
 * customer to tier 1, which is what collections (deposit accounts) require.
 */
export interface UpgradeCustomerTier1Input {
  customer_id: string;
  identification_number: string; // BVN for Nigeria
  dob: string; // "DD-MM-YYYY"
  phone: { phone_country_code: string; phone_number: string };
  address: {
    street: string;
    street2?: string;
    city: string;
    state: string;
    country: string;
    postal_code: string;
  };
  photo?: string; // URL to selfie
}

/**
 * PATCH /customers/upgrade/tier2 — lift a tier 1 customer to tier 2.
 *
 * Needs a government ID: the document itself (a URL Maplerad fetches), its
 * number, and the issuing country. Unlike the tier 1 upgrade this one returns a
 * body — data: { id, status } — so the outcome can be read rather than inferred
 * from the call not throwing.
 */
export interface UpgradeCustomerTier2Input {
  customer_id: string;
  identity: {
    type: "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE";
    image: string; // URL to the uploaded document
    number: string;
    country: string; // "NG"
  };
}

export interface UpgradeCustomerTier2Result {
  id?: string;
  status?: string;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  country: string;
  status: string; // e.g. "COMPLETED"
  tier: number;
  created_at: string;
  updated_at: string;
}

/**
 * GET /customers/{id} — everything Maplerad holds for a customer.
 *
 * ⚠️ There is NO `tier` field, unlike the Customer returned by POST /customers.
 * Tier has to be inferred from whether the identity and address blocks are
 * populated — that is what hasTier1Evidence() does. Do not add a `tier` here on
 * the assumption it is simply undocumented.
 *
 * `identity.number` is a BVN in the clear and `identity.image` a photograph.
 * Neither is persisted anywhere: we hold the BVN encrypted from the user's own
 * submission, and have no use for the photo.
 */
export interface MapleradCustomerDetail {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  email: string;
  phone_number?: string | null;
  dob?: string | null; // DD-MM-YYYY
  type?: string; // "INDIVIDUAL"
  active?: boolean;
  disabled?: boolean;
  identity?: {
    type?: string; // "BVN"
    number?: string; // do not store
    image?: string | null; // do not store
    country?: string;
  } | null;
  address?: {
    street?: string;
    street2?: string | null;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  } | null;
  status?: string; // "COMPLETED"
  can_enrol_visa_card?: boolean;
}

// ---- Wallets --------------------------------------------------------------

export interface Wallet {
  id: string;
  currency: Currency | "";
  ledger_balance: number; // minor units
  available_balance: number; // minor units
  holding_balance: number; // minor units
  active: boolean;
  disabled: boolean;
  wallet_type: WalletType;
  minimum_balance: number;
  display_wallet: boolean;
}

// ---- Virtual accounts / institutions -------------------------------------

/** A collection (virtual) account. NGN accounts return account_number + bank. */
/**
 * One set of wire instructions for a USD account. A USD account can be reached
 * by several rails (ACH, FEDWIRE, SWIFT), each with its own routing/account
 * numbers and memo. Returned by Get Virtual Account by ID.
 */
export interface IbanInstruction {
  instruction_type: string; // ACH | FEDWIRE | SWIFT
  routing_number: string;
  bank_name: string;
  account_type: string;
  account_number: string;
  account_name: string;
  memo: string;
  swift_code: string;
  account_holder_address: string;
  institution_address: string;
}

export interface VirtualAccount {
  id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  currency: Currency;
  created_at: string;
  // Present on USD/EUR accounts:
  status?: string;
  require_consent?: boolean;
  consented?: boolean;
  consent_url?: string | null;
  reference?: string | null;
  // Present on USD accounts (Get Virtual Account by ID): the wire rails.
  iban?: IbanInstruction[];
}

/** Currencies Maplerad's FX rail exchanges between. */
export type FxCurrency = "NGN" | "USD";

/** One side of an FX quote/exchange (amounts are minor units of that currency). */
export interface FxLeg {
  currency: FxCurrency;
  amount: number;
  human_readable_amount: number;
}

/** POST /fx/quote result. `rate` is target whole units per 1 source whole unit. */
export interface FxQuote {
  reference: string;
  source: FxLeg;
  target: FxLeg;
  rate: number;
}

/** POST /fx result — the executed exchange. */
export interface FxExchangeResult {
  source: FxLeg;
  target: FxLeg;
  rate: number;
}

/**
 * Status of a USD account *request* (not the account itself). A USD account is
 * reviewed by Maplerad before it is APPROVED; `message` carries any correction
 * the applicant must make (e.g. a proof-of-address problem) and `kyc_link` is
 * where to fix it.
 * GET /collections/virtual-account/status/{reference}
 */
export interface UsdAccountRequestStatus {
  reference: string;
  account_id: string;
  status: string; // APPROVED | PENDING | DECLINED | ...
  message?: string[];
  currency: Currency;
  kyc_link?: string | null;
}

export interface Institution {
  name: string;
  code: string;
}

export type InstitutionType =
  | "NUBAN"
  | "MOMO"
  | "WALLET"
  | "VIRTUAL"
  | "CBK"
  | "BOG"
  | "MOMOCOLLECTION";

// ---- Webhooks -------------------------------------------------------------

export interface MapleradWebhookEvent<T = unknown> {
  event: string;
  type?: string;
  reference?: string;
  data: T;
  [key: string]: unknown;
}

/**
 * Payload shape for a successful NGN collection (deposit into a virtual
 * account). Field names are inferred from the collection/account model and the
 * transaction responses; confirm against a real sandbox webhook and adjust.
 */
export interface CollectionEventData {
  id: string; // Maplerad transaction id (dedupe key)
  amount: number; // minor units (kobo)
  currency: Currency;
  reference?: string;
  status?: string; // e.g. "SUCCESS"
  account_number?: string; // the virtual account credited
  account_id?: string;
  customer_id?: string;
  created_at?: string;
  [key: string]: unknown;
}
