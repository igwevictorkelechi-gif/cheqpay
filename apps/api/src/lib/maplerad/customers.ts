// apps/api/src/lib/maplerad/customers.ts
//
// Customer enrollment / KYC. The returned customer `id` is the foreign key
// that every other Maplerad resource (accounts, wallets, cards, transfers)
// hangs off, so persist it on the Cheqpay user record.

import { mapleradRequest } from "./client";
import type { Customer, EnrollCustomerInput } from "./types";

/**
 * Enroll a customer with full KYC. This unlocks all Maplerad resources
 * including card issuing. `identification_number` is the BVN for Nigeria.
 *
 * POST /customers/enroll
 */
export async function enrollCustomer(
  input: EnrollCustomerInput,
): Promise<Customer> {
  return mapleradRequest<Customer>("/customers/enroll", {
    method: "POST",
    body: input,
  });
}

/**
 * Update an existing customer (e.g. to upgrade KYC tier or fix details).
 *
 * PATCH /customers/{id}
 */
export async function updateCustomer(
  customerId: string,
  patch: Partial<EnrollCustomerInput>,
): Promise<Customer> {
  return mapleradRequest<Customer>(`/customers/${customerId}`, {
    method: "PATCH",
    body: patch,
  });
}

/** Accounts belonging to a customer. GET /customers/{id}/accounts */
export async function getCustomerAccounts(
  customerId: string,
): Promise<unknown[]> {
  return mapleradRequest<unknown[]>(`/customers/${customerId}/accounts`);
}
