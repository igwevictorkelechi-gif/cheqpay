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
  UsdAccountRequestStatus,
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
 * Open a USD virtual account for a customer.
 * POST /collections/virtual-account/usd
 *
 * Unlike the NGN account this needs a `meta` block of US-banking KYC — the tax
 * ID, employment and residency — because a USD account is a real correspondent
 * account, not a local NUBAN. The response may carry a consent flow
 * (require_consent + consent_url): the user has to accept US banking terms
 * before the account activates, so callers must surface consent_url when set.
 */
export interface UsdAccountMeta {
  identification_number: string;
  employment_status: string;
  employment_description: string;
  nationality: string;
  employer_name: string;
  us_residency_status: string;
}

export async function createUsdAccount(input: {
  customerId: string;
  meta: UsdAccountMeta;
}): Promise<VirtualAccount> {
  return mapleradRequest<VirtualAccount>("/collections/virtual-account/usd", {
    method: "POST",
    body: {
      customer_id: input.customerId,
      meta: input.meta,
    },
  });
}

/**
 * Check the status of a USD account request.
 * GET /collections/virtual-account/status/{reference}
 *
 * A USD account is not instant — Maplerad reviews the KYC before it flips to
 * APPROVED. Poll this with the `reference` returned when the account was opened
 * to learn where the application stands and what (if anything) the user must fix.
 */
export async function checkUsdAccountRequestStatus(
  reference: string,
): Promise<UsdAccountRequestStatus> {
  return mapleradRequest<UsdAccountRequestStatus>(
    `/collections/virtual-account/status/${encodeURIComponent(reference)}`,
  );
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
 * List one page of institutions (banks). Use type "VIRTUAL" for the
 * `preferred_bank` when creating collection accounts, "NUBAN" for NGN payout
 * destinations.
 * GET /institutions?type=&country=&page=&page_size=
 *
 * ⚠️ This endpoint paginates, and `page_size` defaults to 10. The envelope
 * carries `page`, `page_size` and `total` as siblings of `data`, but the shared
 * client unwraps `data` and drops them — so a truncated list is indistinguishable
 * from a complete one here. Use getAllInstitutions() anywhere a missing bank
 * would be a user-visible failure; this function is for probes and single-page
 * reads that do not care.
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

/** Page size used when walking the full institution list. */
const INSTITUTION_PAGE_SIZE = 100;
/** Hard stop so a provider that ignores `page` cannot spin forever. */
const INSTITUTION_PAGE_LIMIT = 20;

/**
 * Every institution of a type, following pagination to the end.
 *
 * Nigeria has far more than 100 NUBAN institutions once microfinance banks are
 * counted, so a single page silently omits banks — and the user whose bank is
 * missing sees no error, just a bank that is not in the list. Walking to the end
 * is the only way to be sure the list is whole.
 */
export async function getAllInstitutions(input: {
  type?: InstitutionType;
  country?: string;
}): Promise<Institution[]> {
  const all: Institution[] = [];
  for (let page = 1; page <= INSTITUTION_PAGE_LIMIT; page++) {
    const batch = await getInstitutions({ ...input, page, pageSize: INSTITUTION_PAGE_SIZE });
    all.push(...batch);
    // A short page is the last page. Relying on this rather than on `total`
    // because the client cannot see `total` — see getInstitutions.
    if (batch.length < INSTITUTION_PAGE_SIZE) return all;
  }
  return all;
}
