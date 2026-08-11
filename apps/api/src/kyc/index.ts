import { getEnv } from "@/lib/env";
import type { KycProvider } from "./types";
import { MockKycProvider } from "./mock";
import { DojahKycProvider } from "./dojah";
import { MapleradKycProvider } from "./maplerad";

export * from "./types";

let cached: KycProvider | null = null;

/** Resolve the configured KYC/identity provider (default: mock). */
export function getKycProvider(): KycProvider {
  if (cached) return cached;
  const env = getEnv();
  if (env.KYC_PROVIDER === "maplerad") {
    // No key check here: this provider goes through the shared Maplerad client,
    // which fails loudly on its own if MAPLERAD_SECRET_KEY is missing.
    cached = new MapleradKycProvider();
  } else if (env.KYC_PROVIDER === "dojah") {
    if (!env.DOJAH_APP_ID || !env.DOJAH_API_KEY) {
      throw new Error("KYC_PROVIDER=dojah requires DOJAH_APP_ID and DOJAH_API_KEY");
    }
    cached = new DojahKycProvider(env.DOJAH_APP_ID, env.DOJAH_API_KEY, env.DOJAH_API_BASE);
  } else {
    cached = new MockKycProvider();
  }
  return cached;
}
