import { getEnv } from "@/lib/env";
import type { CustodyProvider } from "./types";
import { MockCustodyProvider } from "./mock";
import { TatumCustodyProvider } from "./tatum";
import { CryptoApisCustodyProvider } from "./cryptoapis";
import { CoboCustodyProvider } from "./cobo";
import { MapleradCustodyProvider } from "./maplerad";

export * from "./types";

let cached: CustodyProvider | null = null;

function callbackUrl(apiPublicUrl: string, path: string): string {
  return `${apiPublicUrl.replace(/\/$/, "")}${path}`;
}

/**
 * Resolve the configured custody provider. Defaults to the mock unless a live
 * provider (Crypto APIs, or legacy Tatum) is selected and configured.
 */
export function getCustodyProvider(): CustodyProvider {
  if (cached) return cached;

  const env = getEnv();
  if (env.CUSTODY_PROVIDER === "maplerad") {
    if (!env.MAPLERAD_SECRET_KEY) {
      throw new Error("CUSTODY_PROVIDER=maplerad requires MAPLERAD_SECRET_KEY");
    }
    cached = new MapleradCustodyProvider();
  } else if (env.CUSTODY_PROVIDER === "cobo") {
    if (!env.COBO_API_PRIVATE_KEY || !env.COBO_WALLET_ID || !env.COBO_CALLBACK_PUBKEY) {
      throw new Error(
        "CUSTODY_PROVIDER=cobo requires COBO_API_PRIVATE_KEY, COBO_WALLET_ID and COBO_CALLBACK_PUBKEY"
      );
    }
    cached = new CoboCustodyProvider(
      env.COBO_API_PRIVATE_KEY,
      env.COBO_WALLET_ID,
      env.COBO_ENV,
      env.COBO_CALLBACK_PUBKEY
    );
  } else if (env.CUSTODY_PROVIDER === "cryptoapis") {
    if (!env.CRYPTOAPIS_API_KEY || !env.CRYPTOAPIS_WALLET_ID || !env.CRYPTOAPIS_WEBHOOK_SECRET) {
      throw new Error(
        "CUSTODY_PROVIDER=cryptoapis requires CRYPTOAPIS_API_KEY, CRYPTOAPIS_WALLET_ID and CRYPTOAPIS_WEBHOOK_SECRET"
      );
    }
    if (!env.API_PUBLIC_URL) {
      throw new Error(
        "CUSTODY_PROVIDER=cryptoapis requires API_PUBLIC_URL so deposit webhooks can be registered"
      );
    }
    cached = new CryptoApisCustodyProvider(
      env.CRYPTOAPIS_API_KEY,
      env.CRYPTOAPIS_WALLET_ID,
      env.CRYPTOAPIS_WEBHOOK_SECRET,
      callbackUrl(env.API_PUBLIC_URL, "/api/webhooks/cryptoapis"),
      env.CRYPTOAPIS_NETWORK
    );
  } else if (env.CUSTODY_PROVIDER === "tatum") {
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
      callbackUrl(env.API_PUBLIC_URL, "/api/webhooks/tatum")
    );
  } else {
    cached = new MockCustodyProvider(env.TATUM_WEBHOOK_SECRET ?? undefined);
  }
  return cached;
}
