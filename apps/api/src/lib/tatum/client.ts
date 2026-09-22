// apps/api/src/lib/tatum/client.ts
//
// The slice of Tatum's v3 API we use: derive a deposit address from an xpub,
// and subscribe that address so an arrival fires a webhook at us.
//
// Deliberately small. Everything here is read-or-register — nothing in this
// file can move funds, because the server never holds a spending key.

import { tatumApiKey, TATUM_CHAINS, type TatumChain } from "./config";
import { Network } from "@cheqpay/db";

const BASE = (process.env.TATUM_API_BASE?.trim() || "https://api.tatum.io").replace(/\/+$/, "");

export class TatumError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: string,
  ) {
    super(message);
    this.name = "TatumError";
  }
}

function chainFor(network: Network): TatumChain {
  const c = TATUM_CHAINS[network];
  if (!c) throw new TatumError(`Tatum does not serve ${network} in this build`);
  return c;
}

async function tatumFetch(path: string, init?: RequestInit): Promise<unknown> {
  const key = tatumApiKey();
  if (!key) throw new TatumError("TATUM_API_KEY is not set");

  // A hung provider must not hold a request open forever — the deposit screen
  // is on the path users open first.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "x-api-key": key, "content-type": "application/json", ...(init?.headers ?? {}) },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new TatumError(`Tatum unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new TatumError(`Tatum ${init?.method ?? "GET"} ${path} failed`, res.status, text.slice(0, 500));
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new TatumError(`Tatum returned non-JSON for ${path}`, res.status, text.slice(0, 200));
  }
}

/**
 * Derive the deposit address at `index` for a chain's account xpub.
 *
 * Deterministic: the same (xpub, index) always yields the same address, so a
 * lost row can be re-derived and a user's address never silently changes.
 */
export async function deriveAddress(
  network: Network,
  xpub: string,
  index: number,
): Promise<string> {
  const chain = chainFor(network);
  const out = (await tatumFetch(
    `/v3/${chain.path}/address/${encodeURIComponent(xpub)}/${index}`,
  )) as { address?: string };
  const address = typeof out.address === "string" ? out.address.trim() : "";
  if (!address) throw new TatumError(`Tatum returned no address for ${network}[${index}]`);
  return address;
}

/**
 * Watch an address so incoming transfers fire our webhook. Returns Tatum's
 * subscription id.
 *
 * ADDRESS_EVENT covers native and token transfers on the chain, which is what
 * a stablecoin deposit is.
 */
export async function subscribeAddress(
  network: Network,
  address: string,
  url: string,
): Promise<string> {
  const chain = chainFor(network);
  const out = (await tatumFetch("/v3/subscription", {
    method: "POST",
    body: JSON.stringify({
      type: "ADDRESS_EVENT",
      attr: { address, chain: chain.code, url },
    }),
  })) as { id?: string };
  return typeof out.id === "string" ? out.id : "";
}
