import { getEnv } from "@/lib/env";
import type { CustodyProvider } from "./types";
import { MockCustodyProvider } from "./mock";
import { MapleradCustodyProvider } from "./maplerad";

export * from "./types";

let cached: CustodyProvider | null = null;

/**
 * Resolve the configured custody provider: Maplerad in production, or the
 * deterministic mock for local development and tests.
 */
export function getCustodyProvider(): CustodyProvider {
  if (cached) return cached;

  const env = getEnv();
  if (env.CUSTODY_PROVIDER === "maplerad") {
    if (!env.MAPLERAD_SECRET_KEY) {
      throw new Error("CUSTODY_PROVIDER=maplerad requires MAPLERAD_SECRET_KEY");
    }
    cached = new MapleradCustodyProvider();
  } else {
    cached = new MockCustodyProvider();
  }
  return cached;
}
