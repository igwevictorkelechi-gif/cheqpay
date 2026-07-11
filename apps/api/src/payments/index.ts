import { getEnv } from "@/lib/env";
import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";
import { FlutterwaveProvider } from "./flutterwave";
import { PaystackProvider } from "./paystack";

export * from "./types";

let cached: PaymentProvider | null = null;
let cachedFlw: FlutterwaveProvider | null = null;
let cachedPaystack: PaystackProvider | null = null;

/** Flutterwave instance when its keys are configured, else null. */
export function flutterwaveIfConfigured(): FlutterwaveProvider | null {
  const env = getEnv();
  if (!env.FLUTTERWAVE_SECRET_KEY || !env.FLUTTERWAVE_WEBHOOK_HASH) return null;
  if (!cachedFlw) {
    cachedFlw = new FlutterwaveProvider(
      env.FLUTTERWAVE_SECRET_KEY,
      env.FLUTTERWAVE_WEBHOOK_HASH
    );
  }
  return cachedFlw;
}

/** Paystack instance when its key is configured, else null. */
export function paystackIfConfigured(): PaystackProvider | null {
  const env = getEnv();
  if (!env.PAYSTACK_SECRET_KEY) return null;
  if (!cachedPaystack) cachedPaystack = new PaystackProvider(env.PAYSTACK_SECRET_KEY);
  return cachedPaystack;
}

/**
 * The main NGN rail (virtual accounts, payouts, name enquiry, banks),
 * selected by PAYMENT_PROVIDER. Default: mock.
 */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  const env = getEnv();
  if (env.PAYMENT_PROVIDER === "paystack") {
    const ps = paystackIfConfigured();
    if (!ps) {
      throw new Error("PAYMENT_PROVIDER=paystack requires PAYSTACK_SECRET_KEY");
    }
    cached = ps;
  } else if (env.PAYMENT_PROVIDER === "flutterwave") {
    const flw = flutterwaveIfConfigured();
    if (!flw) {
      throw new Error(
        "PAYMENT_PROVIDER=flutterwave requires FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_HASH"
      );
    }
    cached = flw;
  } else {
    cached = new MockPaymentProvider(env.FLUTTERWAVE_WEBHOOK_HASH ?? undefined);
  }
  return cached;
}

/**
 * The bills rail, selected by BILLS_PROVIDER:
 *  - "auto" (default): Flutterwave when its keys exist (Paystack has no bills
 *    product today), otherwise the main provider (mock in dev)
 *  - "flutterwave": force Flutterwave (falls back to main if unconfigured)
 *  - "main": force the PAYMENT_PROVIDER rail
 */
export function getBillsProvider(): PaymentProvider {
  const mode = getEnv().BILLS_PROVIDER;
  if (mode === "main") return getPaymentProvider();
  return flutterwaveIfConfigured() ?? getPaymentProvider();
}
