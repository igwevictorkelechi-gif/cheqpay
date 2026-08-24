// apps/api/src/lib/maplerad/customers.ts
//
// Customer enrollment / KYC. The returned customer `id` is the foreign key
// that every other Maplerad resource (accounts, wallets, cards, transfers)
// hangs off, so persist it on the Cheqpay user record.

import { mapleradRequest } from "./client";
import type {
  Customer,
  CreateCustomerInput,
  EnrollCustomerInput,
  MapleradCustomerDetail,
  UpgradeCustomerTier1Input,
  UpgradeCustomerTier2Input,
  UpgradeCustomerTier2Result,
} from "./types";

/**
 * Open a tier 0 customer. Name, email and country only — no BVN, no date of
 * birth, no phone, no address.
 *
 * POST /customers
 *
 * That short list is the point. Every signed-up user has these four fields, so
 * this call can always succeed, and once it has, the user has a Maplerad
 * customer id. It is the FALLBACK: when we hold the complete identity we enroll
 * in one call (enrollCustomer below); when a field is missing we still open the
 * customer here and upgrade later, so a user is never left with no customer
 * record at all — which is what happened when a single full-enroll call was the
 * only path and any one missing field failed the whole thing.
 */
export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  return mapleradRequest<Customer>("/customers", {
    method: "POST",
    body: input,
  });
}

/**
 * Enroll a customer in full, in one call. Carries the complete identity and
 * returns a customer with access to all Maplerad resources including Issuing.
 *
 * POST /customers/enroll
 *
 * This is the HAPPY PATH, used only when BVN, date of birth, phone and address
 * are all in hand. It requires every one of those, so a caller missing any field
 * must use createCustomer (tier 0) instead and upgrade later — that fallback is
 * the whole reason the two coexist. The returned Customer carries a `tier`
 * (2 in Maplerad's example), so callers read the tier from the response rather
 * than assuming it.
 */
export async function enrollCustomer(input: EnrollCustomerInput): Promise<Customer> {
  return mapleradRequest<Customer>("/customers/enroll", {
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
 * Lift a tier 1 customer to tier 2, which is what raises transaction limits and
 * unlocks crypto withdrawals on our side.
 *
 * PATCH /customers/upgrade/tier2
 *
 * Needs a government ID: the document image as a URL Maplerad fetches, plus its
 * number and country. Both are things we now hold — the KYC form collects an ID
 * type, number and front/back images, and lib/kycDocuments serves each image
 * over a short-lived signed URL. (This was previously left unimplemented on the
 * grounds that the app had no document upload; that is no longer true.)
 *
 * Unlike the tier 1 upgrade this returns a body — data: { id, status } — so the
 * result is read rather than inferred from the call not throwing.
 */
export async function upgradeCustomerTier2(
  input: UpgradeCustomerTier2Input,
): Promise<UpgradeCustomerTier2Result> {
  return mapleradRequest<UpgradeCustomerTier2Result>("/customers/upgrade/tier2", {
    method: "PATCH",
    body: input,
  });
}

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
