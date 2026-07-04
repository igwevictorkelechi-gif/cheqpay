import { getEnv } from "@/lib/env";
import type { KycProvider } from "./types";
import { MockKycProvider } from "./mock";

export * from "./types";

let cached: KycProvider | null = null;

/** Resolve the configured KYC/identity provider (default: mock). */
export function getKycProvider(): KycProvider {
  if (cached) return cached;
  // Only the mock is implemented today. Real providers (Dojah / Smile ID /
  // VerifyMe / Flutterwave BVN) plug in here behind the same interface.
  getEnv();
  cached = new MockKycProvider();
  return cached;
}
