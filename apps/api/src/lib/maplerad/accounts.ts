// apps/api/src/lib/maplerad/accounts.ts
//
// Virtual (collection) accounts. A STATIC account is a dedicated NUBAN we
// create once per Cheqpay user at onboarding — money paid into it lands in the
// business wallet, and a collection webhook tells us which user to credit.
// A DYNAMIC account is a one-time NUBAN for a single expected payment.

import { mapleradRequest } from "./client";
import type {
  Institution,
  InstitutionType,
  Minor,
  VirtualAccount,
} from "./types";

/**
 * Create a permanent NGN virtual account for a customer.
 * POST /collections/virtual-account
 *
 * @param preferredBank optional bank code from getInstitutions(type="VIRTUAL").
 */
export async function createStaticAccount(input: {
  customerId: string;
  currency?: "NGN";
  preferredBank?: string;
}): Promise<VirtualAccount> {
  return mapleradRequest<VirtualAccount>("/collections/virtual-account", {
    method: "POST",
    body: {
      customer_id: input.customerId,
      currency: input.currency ?? "NGN",
      preferred_bank: input.preferredBank,
    },
  });
}

/**
 * Create a one-time-use NGN account for a single expected payment.
 * POST /collections/dynamic-account
 * Note: `account_name` and `preferred_bank` are required here (no customer_id).
 */
export async function createDynamicAccount(input: {
  accountName: string;
  preferredBank: string;
  amount?: Minor;
}): Promise<VirtualAccount> {
  return mapleradRequest<VirtualAccount>("/collections/dynamic-account", {
    method: "POST",
    body: {
      account_name: input.accountName,
      preferred_bank: input.preferredBank,
      amount: input.amount,
    },
  });
}

/**
 * List all virtual accounts for a customer.
 * GET /customers/{customer_id}/virtual-account
 */
export async function getCustomerVirtualAccounts(
  customerId: string,
): Promise<VirtualAccount[]> {
  return mapleradRequest<VirtualAccount[]>(
    `/customers/${customerId}/virtual-account`,
  );
}

/**
 * Fetch a single virtual account by id.
 * GET /collections/virtual-account/{id}  (path inferred — confirm in sandbox)
 */
export async function getVirtualAccountById(
  accountId: string,
): Promise<VirtualAccount> {
  return mapleradRequest<VirtualAccount>(
    `/collections/virtual-account/${accountId}`,
  );
}

/**
 * List institutions (banks). Use type "VIRTUAL" for the `preferred_bank` when
 * creating collection accounts, "NUBAN" for NGN payout destinations.
 * GET /institutions?type=&country=&page=&page_size=
 */
export async function getInstitutions(input: {
  type?: InstitutionType;
  country?: string;
  page?: number;
  pageSize?: number;
}): Promise<Institution[]> {
  return mapleradRequest<Institution[]>("/institutions", {
    query: {
      type: input.type ?? "NUBAN",
      country: input.country ?? "NG",
      page: input.page,
      page_size: input.pageSize,
    },
  });
}
