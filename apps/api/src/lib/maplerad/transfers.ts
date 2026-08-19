// apps/api/src/lib/maplerad/transfers.ts
//
// Outbound payouts from the business wallet: NGN bank transfer, Mobile Money,
// and Maplerad-Pay (to another Maplerad account). Amounts are minor units.
//
// ALWAYS pass a unique `reference` (idempotency) and persist it BEFORE calling,
// so a retry after a network blip can't double-send. Some transfers (notably
// MoMo) require an OTP step — handle the PENDING/requires-OTP branch with
// verifyOtp().

import { mapleradRequest } from "./client";
import type { Institution, Minor } from "./types";

/**
 * `MOBILEMONEY` or the default. Maplerad's schema contradicts itself here: the
 * enum is ["MOBILEMONEY", ""] while the stated default is "DOM", which is not in
 * its own enum. Both spellings are kept because there is no way to tell from the
 * documentation which one the API actually honours for a domestic transfer.
 */
export type TransferScheme = "MOBILEMONEY" | "DOM" | "";

/**
 * Wallets POST /transfers will debit. Deliberately NOT the shared `Currency`
 * type: that one includes USD, USDC, USDT and GHS, none of which this endpoint
 * accepts. Passing one would be rejected by the provider rather than caught here.
 */
export type TransferCurrency = "NGN" | "KES" | "XAF" | "XOF" | "TZX" | "UGX";

export interface TransferInput {
  bankCode: string; // from getAllInstitutions(type="NUBAN") etc.
  accountNumber: string;
  amount: Minor;
  currency?: TransferCurrency; // "NGN" default; KES/XAF/XOF => MobileMoney
  reason?: string;
  reference: string; // REQUIRED for idempotency
  meta?: {
    scheme?: TransferScheme;
    counterparty?: { name: string };
  };
}

/**
 * Maplerad's documented 200 body for /transfers is an echo of the request —
 * bank_code, account_number, amount, meta — with no id and no status. That looks
 * like a copy-paste slip in their docs rather than reality, but everything here
 * is optional so a caller cannot assume either shape. Settlement matches on our
 * own `reference` via the transfer.* webhook, so nothing depends on `id`.
 */
export interface TransferResult {
  id?: string;
  status?: string; // "SUCCESS" | "PENDING" | ...
  reference?: string;
  requires_otp?: boolean;
  [key: string]: unknown;
}

/**
 * Initiate a local (African) payout.
 * POST /transfers
 */
export async function sendTransfer(input: TransferInput): Promise<TransferResult> {
  return mapleradRequest<TransferResult>("/transfers", {
    method: "POST",
    idempotencyKey: input.reference,
    body: {
      bank_code: input.bankCode,
      account_number: input.accountNumber,
      amount: input.amount,
      currency: input.currency ?? "NGN",
      reason: input.reason,
      reference: input.reference,
      meta: input.meta,
    },
  });
}

/**
 * Complete a transfer/collection that returned a requires-OTP / PENDING state.
 * POST /collections/momo/verify-otp
 */
export async function verifyOtp(input: {
  transactionId: string;
  otp: string;
}): Promise<TransferResult> {
  return mapleradRequest<TransferResult>("/collections/momo/verify-otp", {
    method: "POST",
    body: { transaction_id: input.transactionId, otp: input.otp },
  });
}

// ---- Recipient resolution -------------------------------------------------

/**
 * Resolve a NUBAN + bank code to the account holder name before sending.
 * Prefer showing this to the user for confirmation.
 * POST /institutions/resolve
 *
 * Takes `account_number` and `bank_code`, and nothing else — a `currency` used
 * to be sent here too, which is not in the request schema and so was never read.
 *
 * ⚠️ Sandbox returns a dummy name for any input. A name coming back in sandbox
 * is not evidence the account exists; only Live resolves a real NUBAN.
 */
export async function resolveAccountName(input: {
  bankCode: string;
  accountNumber: string;
}): Promise<{ account_name: string; account_number: string } & Record<string, unknown>> {
  return mapleradRequest("/institutions/resolve", {
    method: "POST",
    body: {
      bank_code: input.bankCode,
      account_number: input.accountNumber,
    },
  });
}

/**
 * Fetch institution details from a routing number (US rails). Returns
 * institution_name, address {address, state, zip_code} and phone_number.
 * POST /institutions/fetch
 */
export async function fetchBankDetails(input: {
  routingNumber: string;
  countryCode: string;
}): Promise<Record<string, unknown>> {
  return mapleradRequest("/institutions/fetch", {
    method: "POST",
    body: {
      routing_number: input.routingNumber,
      country_code: input.countryCode,
    },
  });
}

export type { Institution };
