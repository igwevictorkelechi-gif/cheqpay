// apps/api/src/lib/maplerad/bills.ts
//
// Bill payments: data, cable TV, electricity. These debit the business wallet
// directly (no per-customer account needed). All amounts are minor units (kobo).
//
// Cutover strategy: keep the existing Flutterwave path and select the provider
// via a flag (see `BillsProvider` below / your feature-flags module) so you can
// A/B and roll back per bill type without a redeploy.
//
// NOTE: the public reference lists data / cable / electricity billers only.
// Airtime is not documented here — confirm with Maplerad whether airtime is a
// `data` biller variant or must remain on Flutterwave (Open question O1).

import { mapleradRequest } from "./client";
import type { Minor } from "./types";

// ---- Discovery ------------------------------------------------------------

export type BillType = "data" | "cable" | "electricity";

export interface Biller {
  name: string;
  identifier: string; // e.g. "mtn-data-ng", "dstv-ng", "ikeja-electricity-prepaid-ng"
  commission: number;
}

/** GET /bills/{type}/billers/{country} */
export async function getBillers(
  type: BillType,
  country = "NG",
): Promise<Biller[]> {
  return mapleradRequest<Biller[]>(`/bills/${type}/billers/${country}`);
}

export interface DataBundle {
  name: string;
  price: number; // minor units
  code: string; // -> bundle_identifier
  validity: string;
  data: string;
}

/** GET /bills/{bill_type}/bundle/{biller} */
export async function getDataBundles(biller: string): Promise<DataBundle[]> {
  return mapleradRequest<DataBundle[]>(`/bills/data/bundle/${biller}`);
}

export interface CablePlanGroup {
  title: string;
  plan_id: string;
  subscription_plans: Array<{
    subscription_id: string;
    duration: { value: number; type: string };
    price: number; // minor units
  }>;
}

/** GET /bills/cable/subscriptions/{biller_identifier} */
export async function getCablePlans(
  billerIdentifier: string,
): Promise<CablePlanGroup[]> {
  return mapleradRequest<CablePlanGroup[]>(
    `/bills/cable/subscriptions/${billerIdentifier}`,
  );
}

// ---- Purchases ------------------------------------------------------------

export interface BillResult {
  id: string; // Maplerad transaction id
  status: string; // "SUCCESS"
  currency: string;
  amount: number;
  debit_amount: number;
  commission_earned: number;
  created_at: string;
  [key: string]: unknown;
}

/**
 * Buy data. `amount` must equal the chosen bundle's price (minor units).
 * POST /bills/data
 */
export async function buyData(input: {
  identifier: string; // biller, e.g. "mtn-data-ng"
  bundleIdentifier: string; // bundle `code`
  phoneNumber: string;
  amount: Minor;
}): Promise<BillResult> {
  return mapleradRequest<BillResult>("/bills/data", {
    method: "POST",
    body: {
      identifier: input.identifier,
      bundle_identifier: input.bundleIdentifier,
      phone_number: input.phoneNumber,
      amount: input.amount,
    },
  });
}

/**
 * Buy a cable TV subscription.
 * POST /bills/cable
 */
export async function buyCable(input: {
  identifier: string; // e.g. "dstv-ng"
  serialNumber: string; // smartcard / IUC number
  amount: Minor;
  duration?: string;
  subscriptionId?: string;
  addons?: string[];
}): Promise<BillResult & { smartcard_number?: string; plan?: string }> {
  return mapleradRequest("/bills/cable", {
    method: "POST",
    body: {
      identifier: input.identifier,
      serial_number: input.serialNumber,
      amount: input.amount,
      duration: input.duration,
      subscription_id: input.subscriptionId,
      addons: input.addons,
    },
  });
}

export interface MeterResolution {
  meter_number: string;
  identifier: string;
  name: string;
}

/**
 * Resolve a meter to the account holder name BEFORE charging. Always show this
 * to the user for confirmation to avoid vending to the wrong meter.
 * POST /bills/electricity/resolve-account
 */
export async function resolveMeter(input: {
  meterNumber: string;
  identifier: string;
}): Promise<MeterResolution> {
  return mapleradRequest<MeterResolution>("/bills/electricity/resolve-account", {
    method: "POST",
    body: { meter_number: input.meterNumber, identifier: input.identifier },
  });
}

/**
 * Buy electricity. Response carries the prepaid `token` for prepaid meters.
 * POST /bills/electricity
 */
export async function buyElectricity(input: {
  meterNumber: string;
  identifier: string; // e.g. "ikeja-electricity-prepaid-ng"
  amount: Minor;
  phoneNumber: string;
}): Promise<
  BillResult & { token?: string; token_amount?: number; amount_of_power?: string }
> {
  return mapleradRequest("/bills/electricity", {
    method: "POST",
    body: {
      meter_number: input.meterNumber,
      identifier: input.identifier,
      amount: input.amount,
      phone_number: input.phoneNumber,
    },
  });
}
