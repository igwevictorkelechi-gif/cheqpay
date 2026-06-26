import { getEnv } from "@/lib/env";
import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";
import { FlutterwaveProvider } from "./flutterwave";

export * from "./types";

let cached: PaymentProvider | null = null;

/** Resolve the configured payment provider (default: mock). */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  const env = getEnv();
  if (env.PAYMENT_PROVIDER === "flutterwave") {
    if (!env.FLUTTERWAVE_SECRET_KEY || !env.FLUTTERWAVE_WEBHOOK_HASH) {
      throw new Error(
        "PAYMENT_PROVIDER=flutterwave requires FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_HASH"
      );
    }
    cached = new FlutterwaveProvider(
      env.FLUTTERWAVE_SECRET_KEY,
      env.FLUTTERWAVE_WEBHOOK_HASH
    );
  } else {
    cached = new MockPaymentProvider(env.FLUTTERWAVE_WEBHOOK_HASH ?? undefined);
  }
  return cached;
}
