// apps/api/src/lib/tatum/addresses.ts
//
// Minting per-user deposit addresses from the chain xpubs.
//
// A per-user address is what makes automatic crediting possible at all: with
// one shared business address the chain cannot tell you WHICH user sent funds,
// so every deposit needs a human. Derived addresses carry the identity.
//
// Index allocation uses a Postgres SEQUENCE per chain. nextval() is atomic
// under concurrency, so two users provisioning at the same instant can never be
// handed the same index — and therefore never the same address.

import { Asset, Network, prisma } from "@cheqpay/db";
import { deriveAddress, subscribeAddress } from "./client";
import { tatumEnabled, tatumNetworks, tatumWebhookUrl, xpubFor } from "./config";

/** Assets we mint an address for on each chain. */
const CHAIN_ASSETS: Partial<Record<Network, Asset[]>> = {
  [Network.BITCOIN]: [Asset.BTC],
  [Network.BSC]: [Asset.USDT, Asset.USDC],
  [Network.ETHEREUM]: [Asset.USDT, Asset.USDC],
  [Network.TRON]: [Asset.USDT, Asset.USDC],
  [Network.POLYGON]: [Asset.USDT, Asset.USDC],
};

function sequenceName(network: Network): string {
  return `tatum_addr_idx_${network.toLowerCase()}`;
}

let sequencesReady: Promise<void> | null = null;

/** Create the per-chain index sequences, once per runtime. */
export function ensureTatumSequences(): Promise<void> {
  if (!sequencesReady) {
    sequencesReady = (async () => {
      for (const network of Object.keys(CHAIN_ASSETS) as Network[]) {
        await prisma.$executeRawUnsafe(
          `CREATE SEQUENCE IF NOT EXISTS ${sequenceName(network)} START 1`,
        );
      }
    })().catch((err) => {
      sequencesReady = null;
      throw err;
    });
  }
  return sequencesReady;
}

async function nextIndex(network: Network): Promise<number> {
  await ensureTatumSequences();
  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('${sequenceName(network)}') AS nextval`,
  );
  return Number(rows[0].nextval);
}

/**
 * Get (or mint) this user's deposit address for one asset on one chain.
 *
 * Idempotent: an existing row is returned untouched, so a user's address never
 * changes underneath them. Subscription failures do NOT fail the mint — the
 * address is still valid and can be re-subscribed; losing the address would be
 * the worse outcome.
 */
export async function ensureTatumWallet(
  userId: string,
  asset: Asset,
  network: Network,
): Promise<{ address: string; network: Network; asset: Asset } | null> {
  if (!tatumEnabled(network)) return null;

  const existing = await prisma.wallet.findUnique({
    where: { userId_asset_network: { userId, asset, network } },
    select: { address: true },
  });
  if (existing) return { address: existing.address, network, asset };

  const xpub = xpubFor(network);
  if (!xpub) return null;

  const index = await nextIndex(network);
  const address = await deriveAddress(network, xpub, index);

  let subscriptionId = "";
  const url = tatumWebhookUrl();
  if (url) {
    try {
      subscriptionId = await subscribeAddress(network, address, url);
    } catch (err) {
      // Watchable later; an unwatched address still receives funds and can be
      // reconciled, so this must not cost the user their address.
      console.error("[tatum] address subscribe failed", { network, address, err });
    }
  }

  try {
    await prisma.wallet.create({
      data: {
        userId,
        asset,
        network,
        address,
        custodyRef: `tatum:${index}${subscriptionId ? `:${subscriptionId}` : ""}`,
      },
    });
  } catch {
    // Lost a race with a concurrent provision — the other row is authoritative.
    const row = await prisma.wallet.findUnique({
      where: { userId_asset_network: { userId, asset, network } },
      select: { address: true },
    });
    if (row) return { address: row.address, network, asset };
    throw new Error("could not persist derived address");
  }

  return { address, network, asset };
}

/**
 * Provision every Tatum-backed address this user should have.
 *
 * Best-effort per combination: one chain being unreachable must not stop the
 * others from being minted.
 */
export async function ensureTatumWalletsForUser(userId: string): Promise<number> {
  let minted = 0;
  for (const network of tatumNetworks()) {
    for (const asset of CHAIN_ASSETS[network] ?? []) {
      try {
        const out = await ensureTatumWallet(userId, asset, network);
        if (out) minted++;
      } catch (err) {
        console.error("[tatum] mint failed", { userId, asset, network, err });
      }
    }
  }
  return minted;
}

export { CHAIN_ASSETS };
