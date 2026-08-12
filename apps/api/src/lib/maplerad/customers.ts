// apps/api/src/lib/maplerad/customers.ts
//
// Customer enrollment / KYC. The returned customer `id` is the foreign key
// that every other Maplerad resource (accounts, wallets, cards, transfers)
// hangs off, so persist it on the Cheqpay user record.

import { mapleradRequest } from "./client";
import type { Customer, CreateCustomerInput, UpgradeCustomerTier1Input } from "./types";

/**
 * Open a tier 0 customer. Name, email and country only — no BVN, no date of
 * birth, no phone, no address.
 *
 * POST /customers
 *
 * That short list is the point. Every signed-up user has these four fields, so
 * this call can always succeed, and once it has, the user has a Maplerad
 * customer id. The code used to make a single /customers/enroll call carrying
 * the full identity, which meant a user missing any one field had no customer
 * record at all — and every downstream feature failed with "no Maplerad
 * customer record yet" rather than with the actual reason.
 */
export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  return mapleradRequest<Customer>("/customers", {
    method: "POST",
    body: input,
  });
}

/**
 * Lift a tier 0 customer to tier 1, which is what collections — and therefore
 * NGN deposit accounts — require.
 *
 * PATCH /customers/upgrade/tier1
 *
 * Returns only { status, message }: there is no customer object in the body, so
 * nothing here may read a tier back off the response. Success is the absence of
 * a thrown MapleradError.
 */
export async function upgradeCustomerTier1(
  input: UpgradeCustomerTier1Input,
): Promise<void> {
  await mapleradRequest<void>("/customers/upgrade/tier1", {
    method: "PATCH",
    body: input,
  });
}

/**
 * Correct details on an existing customer.
 *
 * PATCH /customers/{id}
 *
 * Not the way to change tier — that is upgradeCustomerTier1 above, which is a
 * different endpoint with its own required fields.
 */
export async function updateCustomer(
  customerId: string,
  patch: Partial<CreateCustomerInput>,
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
