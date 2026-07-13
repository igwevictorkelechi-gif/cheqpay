import { getEnv } from "@/lib/env";
import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";
import { MapleradProvider } from "./maplerad";

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

/**
 * The bills rail. Maplerad covers every bill service we actually sell (airtime,
 * data, electricity, cable TV), so bills run on the same rail as everything
 * else. Betting and food have no Maplerad biller and are marked "coming soon"
 * in the catalog, so they never get here.
 */
export function getBillsProvider(): PaymentProvider {
  return getPaymentProvider();
}
