import { Network } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getManualWallets, MANUAL_ASSETS } from "@/lib/manualCrypto";
import { getFeatureFlags } from "@/lib/features";
import { listWallets, provisionWalletsDetailed } from "@/lib/wallets";
import { CRYPTO_COINS, CRYPTO_NETWORKS } from "@/lib/assets";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Human label per chain, so the client never has to map enum values itself. */
const NETWORK_LABELS: Partial<Record<Network, string>> = {
  [Network.SOLANA]: "Solana (SPL)",
  [Network.BASE]: "Base",
  [Network.POLYGON]: "Polygon",
  [Network.ETHEREUM]: "Ethereum (ERC-20)",
  [Network.TRON]: "Tron (TRC-20)",
  [Network.BSC]: "BNB Smart Chain (BEP-20)",
  [Network.BITCOIN]: "Bitcoin",
};

/**
 * The crypto deposit addresses this user can fund.
 *
 * Per-user Maplerad addresses come first: they are minted for one holder, so an
 * incoming deposit identifies its owner by the address alone and the webhook can
 * credit it automatically. Manual (admin-configured) wallets are the fallback
 * for assets custody cannot mint — BTC today — and those still need a human to
 * credit, which is why they are not preferred.
 *
 * Addresses are provisioned on demand: a user who verified before their chain
 * was supported would otherwise be stuck with no address and no way to ask for
 * one. Provisioning is idempotent and failure-tolerant, so a provider outage
 * degrades to "nothing live yet" rather than an error.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);

    // The three reads below are independent, so they go together rather than
    // one after another. This endpoint is on the path the receive screen opens
    // with, and on a cold lambda three sequential round trips to Postgres is
    // most of what the user experiences as "loading".
    const [flags, wallets0, manual] = await Promise.all([
      getFeatureFlags(),
      listWallets(auth.id),
      getManualWallets(),
    ]);

    // Kill switch: with crypto deposits off, every asset reads as
    // "Coming soon" in the apps (empty list) rather than erroring.
    if (!flags.crypto_deposits) {
      return jsonOk({ addresses: [], networks: [] });
    }

    // Mint the launch set if this user has none yet. Best-effort: an address we
    // already hold is still returned when the provider is unreachable.
    //
    // Throttled, because the miss case repeats. A user whose minting cannot
    // succeed — custody down, provider refusing, no Maplerad customer yet —
    // has no wallets on every single visit, and without this the screen calls
    // the provider every time it opens and waits for the same failure. Once a
    // minute is enough to pick up a recovery; the rest of the time the stored
    // rows answer on their own.
    let wallets = wallets0;
    let blocked: string | undefined;
    let mintError: string | undefined;
    if (wallets.length === 0) {
      if (rateLimit(`mint:auto:${auth.id}`, 1, 60_000).allowed) {
        const report = await provisionWalletsDetailed(auth.id).catch((err) => {
          console.error("[deposit-addresses] provisioning failed", err);
          return { wallets: [], outcomes: [], blocked: String(err) };
        });
        wallets = report.wallets;
        blocked = report.blocked;
        mintError = report.outcomes.find((o) => o.status === "failed")?.error;
      } else {
        blocked = "address is still being generated";
      }
    }

    const addresses = wallets.map((w) => ({
      asset: w.asset,
      address: w.address,
      network: w.network,
      networkLabel: NETWORK_LABELS[w.network] ?? String(w.network),
      /** Minted for this user — deposits credit automatically. */
      managed: true,
    }));

    // Manual (shared, admin-configured) wallets fill in ONLY for assets custody
    // cannot mint — BTC today.
    //
    // Never for USDT/USDC: a manual wallet is one address shared by every user,
    // so a deposit into it cannot be attributed to anyone. The crypto webhook
    // credits by matching the deposit address to its holder, which is exactly
    // what a shared address destroys. Showing it would look like it worked and
    // silently produce deposits nobody can be credited for.
    const mintableAssets = new Set<string>(CRYPTO_COINS);
    const covered = new Set(addresses.map((a) => a.asset));
    for (const a of MANUAL_ASSETS) {
      const entry = manual[a];
      if (entry && !covered.has(a) && !mintableAssets.has(a)) {
        addresses.push({
          asset: a,
          address: entry.address,
          network: entry.network as Network,
          networkLabel: entry.networkLabel,
          managed: false,
        });
      }
    }

    // Mintable assets with no address yet: say so, with the reason, instead of
    // going quiet or handing back somebody else's wallet.
    const pending = CRYPTO_COINS.filter((a) => !covered.has(a)).map((asset) => ({
      asset,
      reason: blocked ?? mintError ?? "address is still being generated",
    }));

    // Which chains the user could additionally request, so the client can offer
    // a network selector without hardcoding the list.
    const networks = CRYPTO_NETWORKS.map((n) => ({
      network: n,
      label: NETWORK_LABELS[n] ?? String(n),
    }));

    return jsonOk({ addresses, networks, pending });
  } catch (err) {
    return toErrorResponse(err);
  }
}
