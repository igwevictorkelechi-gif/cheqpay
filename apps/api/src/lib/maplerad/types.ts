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
    type: IdentityType;
    image: string; // URL to uploaded document
    number: string;
    country: string;
  };
  photo?: string; // URL to selfie
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
