// apps/api/src/lib/tatum/config.ts
//
// Tatum custody configuration: which chains we mint per-user deposit addresses
// on, and the extended public key each one derives from.
//
// Only the XPUB lives here. An xpub can derive addresses but cannot spend, so
// the server never holds anything that can move customer funds — the mnemonic
// that can stays offline with the business. That is the whole reason deposits
// can be automated safely while withdrawals remain a deliberate human action.
//
// Everything is optional: with no API key or no xpub for a chain, that chain
// simply isn't Tatum-backed and the existing manual-wallet behaviour stands.

import { Network } from "@cheqpay/db";

export interface TatumChain {
  /** Path segment used by the v3 address-derivation endpoint. */
  path: string;
  /** Short code the v3 subscription API expects in `attr.chain`. */
  code: string;
  /** How the notification payload spells the chain (prefix match). */
  notifyPrefix: string;
  /** Env var holding the account xpub for this chain. */
  xpubEnv: string;
}

export const TATUM_CHAINS: Partial<Record<Network, TatumChain>> = {
  [Network.BITCOIN]: {
    path: "bitcoin",
    code: "BTC",
    notifyPrefix: "bitcoin",
    xpubEnv: "TATUM_XPUB_BITCOIN",
  },
  [Network.ETHEREUM]: {
    path: "ethereum",
    code: "ETH",
    notifyPrefix: "ethereum",
    xpubEnv: "TATUM_XPUB_ETHEREUM",
  },
  [Network.BSC]: {
    path: "bsc",
    code: "BSC",
    notifyPrefix: "bsc",
    xpubEnv: "TATUM_XPUB_BSC",
  },
  [Network.TRON]: {
    path: "tron",
    code: "TRON",
    notifyPrefix: "tron",
    xpubEnv: "TATUM_XPUB_TRON",
  },
  [Network.POLYGON]: {
    path: "polygon",
    code: "MATIC",
    notifyPrefix: "polygon",
    xpubEnv: "TATUM_XPUB_POLYGON",
  },
};

export function tatumApiKey(): string | undefined {
  const k = process.env.TATUM_API_KEY?.trim();
  return k ? k : undefined;
}

/** The xpub configured for a chain, or undefined when it isn't Tatum-backed. */
export function xpubFor(network: Network): string | undefined {
  const chain = TATUM_CHAINS[network];
  if (!chain) return undefined;
  const v = process.env[chain.xpubEnv]?.trim();
  return v ? v : undefined;
}

/** True when this deployment can mint and watch addresses on `network`. */
export function tatumEnabled(network: Network): boolean {
  return !!tatumApiKey() && !!xpubFor(network);
}

/** Every network this deployment is configured to serve through Tatum. */
export function tatumNetworks(): Network[] {
  return (Object.keys(TATUM_CHAINS) as Network[]).filter((n) => tatumEnabled(n));
}

/** Public URL Tatum should call. Falls back to the API's own public origin. */
export function tatumWebhookUrl(): string | undefined {
  const explicit = process.env.TATUM_WEBHOOK_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const base = process.env.API_PUBLIC_URL?.trim();
  return base ? `${base.replace(/\/+$/, "")}/api/webhooks/tatum` : undefined;
}
