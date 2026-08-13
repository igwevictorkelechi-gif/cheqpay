// apps/api/src/lib/maplerad/customers.ts
//
// Customer enrollment / KYC. The returned customer `id` is the foreign key
// that every other Maplerad resource (accounts, wallets, cards, transfers)
// hangs off, so persist it on the Cheqpay user record.

import { mapleradRequest } from "./client";
import type {
  Customer,
  CreateCustomerInput,
  MapleradCustomerDetail,
  UpgradeCustomerTier1Input,
} from "./types";

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
 * Tier 2 is PATCH /customers/upgrade/tier2 and is deliberately not implemented
 * here, because it would have no caller: it requires a government ID as
 * { type: NIN | PASSPORT | VOTERS_CARD | DRIVERS_LICENSE, image, number,
 * country } where `image` is a URL to a hosted document, and this app has no
 * document upload. kycTier1Schema carries a documentRefs array, but nothing in
 * either client populates it.
 *
 * Recorded rather than written so whoever wires card issuing has the contract
 * to hand. One asymmetry to note when they do: unlike tier 1, tier 2 returns a
 * body — data: { id, status } — so its result can be read rather than inferred
 * from the call not throwing.
 */

/**
 * Fetch what Maplerad holds for a customer.
 *
 * GET /customers/{id}
 *
 * Read-only: it creates nothing and moves no money, so it is safe to call on any
 * path. Two jobs here.
 *
 * First, it proves a stored customer id is real. Ours can be set by hand — a
 * customer created on the Maplerad dashboard has to be pasted into the user row
 * to connect the two — and a wrong id would otherwise wedge the account
 * permanently: every downstream call would fail against an id that does not
 * exist, while the code kept assuming enrolment was already done.
 *
 * Second, it says whether the tier 1 evidence is already on file. Note the
 * response carries NO tier field — see MapleradCustomerDetail — so tier has to
 * be read from whether identity and address are present, not from a number.
 */
export async function getCustomer(customerId: string): Promise<MapleradCustomerDetail> {
  return mapleradRequest<MapleradCustomerDetail>(`/customers/${customerId}`);
}

/**
 * Whether Maplerad already holds everything the tier 1 upgrade would supply.
 *
 * The upgrade needs a BVN, a date of birth, a phone and a full address. When the
 * fetched customer already has all four, the customer is at tier 1 whatever our
 * local column says, and re-sending the upgrade is at best a no-op.
 */
export function hasTier1Evidence(c: MapleradCustomerDetail): boolean {
  return Boolean(
    c.identity?.number && c.dob && c.phone_number && c.address?.street && c.address?.city,
  );
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
