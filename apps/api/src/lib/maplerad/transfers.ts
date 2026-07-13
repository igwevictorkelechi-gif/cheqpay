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
import type { Currency, Institution, Minor } from "./types";

export type TransferScheme = "MOBILEMONEY" | "DOM";

export interface TransferInput {
  bankCode: string; // from getInstitutions(type="NUBAN") etc.
  accountNumber: string;
  amount: Minor;
  currency?: Currency; // "NGN" default; GHS/KES/XAF => MobileMoney
  reason?: string;
  reference: string; // REQUIRED for idempotency
  meta?: {
    scheme?: TransferScheme;
    counterparty?: { name: string };
  };
}

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
 * Prefer showing this to the user for confirmation. Path is inferred from the
 * institutions namespace — confirm the exact resolve endpoint in sandbox.
 * (Kept optional; sendTransfer works without it.)
 */
export async function resolveAccountName(input: {
  bankCode: string;
  accountNumber: string;
  currency?: Currency;
}): Promise<{ account_name: string } & Record<string, unknown>> {
  return mapleradRequest("/institutions/resolve", {
    method: "POST",
    body: {
      bank_code: input.bankCode,
      account_number: input.accountNumber,
      currency: input.currency ?? "NGN",
    },
  });
}

/**
 * Fetch institution details from a routing number (US rails).
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
