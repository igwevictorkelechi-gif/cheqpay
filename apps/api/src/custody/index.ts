import { getEnv } from "@/lib/env";
import type { CustodyProvider } from "./types";
import { MockCustodyProvider } from "./mock";
import { TatumCustodyProvider } from "./tatum";

export * from "./types";

let cached: CustodyProvider | null = null;

/**
 * Resolve the configured custody provider. Defaults to the mock unless
 * CUSTODY_PROVIDER=tatum and the Tatum credentials are present.
 */
export function getCustodyProvider(): CustodyProvider {
  if (cached) return cached;

  const env = getEnv();
  if (env.CUSTODY_PROVIDER === "tatum") {
    if (!env.TATUM_API_KEY || !env.TATUM_WEBHOOK_SECRET) {
      throw new Error(
        "CUSTODY_PROVIDER=tatum requires TATUM_API_KEY and TATUM_WEBHOOK_SECRET"
      );
    }
    if (!env.API_PUBLIC_URL) {
      throw new Error(
        "CUSTODY_PROVIDER=tatum requires API_PUBLIC_URL so deposit webhooks can be registered"
      );
    }
    cached = new TatumCustodyProvider(
      env.TATUM_API_KEY,
      env.TATUM_WEBHOOK_SECRET,
      `${env.API_PUBLIC_URL.replace(/\/$/, "")}/api/webhooks/tatum`
    );
  } else {
    cached = new MockCustodyProvider(env.TATUM_WEBHOOK_SECRET ?? undefined);
  }
  return cached;
}
