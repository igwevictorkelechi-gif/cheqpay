import { assertNotMockInProduction, assertProviderConfigured, getEnv } from "@/lib/env";
import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";
import { MapleradProvider } from "./maplerad";
import { VtuNgProvider, type BillQueryResult } from "./vtung";

export * from "./types";

let cached: PaymentProvider | null = null;
let cachedMaplerad: MapleradProvider | null = null;

/** Maplerad instance when its key is configured, else null. */
export function mapleradIfConfigured(): MapleradProvider | null {
  const env = getEnv();
  if (!env.MAPLERAD_SECRET_KEY) return null;
  if (!cachedMaplerad) {
    cachedMaplerad = new MapleradProvider(
      env.MAPLERAD_SECRET_KEY,
      env.MAPLERAD_BASE_URL
    );
  }
  return cachedMaplerad;
}

/**
 * The NGN rail (bills, payouts, name enquiry, banks), selected by
 * PAYMENT_PROVIDER. Maplerad is the only live provider; "mock" (the default)
 * keeps local dev and tests free of external calls.
 */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  const env = getEnv();
  // Before resolving, not after: a misconfigured or production-mock rail must
  // refuse the request rather than answer it with an invented account number.
  assertProviderConfigured("PAYMENT_PROVIDER");
  assertNotMockInProduction("PAYMENT_PROVIDER", env.PAYMENT_PROVIDER);

  if (env.PAYMENT_PROVIDER === "maplerad") {
    const mp = mapleradIfConfigured();
    if (!mp) {
      throw new Error("PAYMENT_PROVIDER=maplerad requires MAPLERAD_SECRET_KEY");
    }
    cached = mp;
  } else {
    cached = new MockPaymentProvider();
  }
  return cached;
}

/** What bills need from a provider — the NGN rail and vtu.ng both offer it. */
export type BillsProvider = Pick<PaymentProvider, "name" | "validateBillCustomer" | "payBill" | "listBillPlans"> & {
  /** Ask what became of a purchase, by our reference. Providers without one omit it. */
  queryBill?(reference: string): Promise<BillQueryResult>;
};

let cachedVtu: VtuNgProvider | null = null;

/** vtu.ng when its login is configured, else null. */
export function vtuNgIfConfigured(): VtuNgProvider | null {
  const env = getEnv();
  if (!env.VTU_NG_USERNAME || !env.VTU_NG_PASSWORD) return null;
  cachedVtu ??= new VtuNgProvider(env.VTU_NG_USERNAME, env.VTU_NG_PASSWORD);
  return cachedVtu;
}

/**
 * The bills rail (airtime, data, electricity, cable TV). BILLS_PROVIDER=vtung
 * sends new purchases to vtu.ng; otherwise they stay on the NGN rail. Betting
 * and food have no biller and are "coming soon", so they never get here.
 */
export function getBillsProvider(): BillsProvider {
  if (getEnv().BILLS_PROVIDER === "vtung") {
    const vtu = vtuNgIfConfigured();
    if (!vtu) throw new Error("BILLS_PROVIDER=vtung requires VTU_NG_USERNAME and VTU_NG_PASSWORD");
    return vtu;
  }
  return getPaymentProvider();
}

/** The provider a past bill was bought on, so we ask the right one about it. */
export function billsProviderNamed(name: string | null | undefined): BillsProvider | null {
  if (name === "vtung") return vtuNgIfConfigured();
  return getPaymentProvider();
}
