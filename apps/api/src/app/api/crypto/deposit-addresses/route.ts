import { Network } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getManualWallets, MANUAL_ASSETS } from "@/lib/manualCrypto";
import { getFeatureFlags } from "@/lib/features";
import { listWallets, provisionWallets } from "@/lib/wallets";
import { CRYPTO_NETWORKS } from "@/lib/assets";

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

    // Kill switch: with crypto deposits off, every asset reads as
    // "Coming soon" in the apps (empty list) rather than erroring.
    const flags = await getFeatureFlags();
    if (!flags.crypto_deposits) {
      return jsonOk({ addresses: [], networks: [] });
    }

    // Mint the launch set if this user has none yet. Best-effort: an address we
    // already hold is still returned when the provider is unreachable.
    let wallets = await listWallets(auth.id);
    if (wallets.length === 0) {
      wallets = await provisionWallets(auth.id).catch((err) => {
        console.error("[deposit-addresses] provisioning failed", err);
        return [];
      });
    }

    const addresses = wallets.map((w) => ({
      asset: w.asset,
      address: w.address,
      network: w.network,
      networkLabel: NETWORK_LABELS[w.network] ?? String(w.network),
      /** Minted for this user — deposits credit automatically. */
      managed: true,
    }));

    // Fall back to a manual wallet only for an asset with no minted address.
    const covered = new Set(addresses.map((a) => a.asset));
    const manual = await getManualWallets();
    for (const a of MANUAL_ASSETS) {
      const entry = manual[a];
      if (entry && !covered.has(a)) {
        addresses.push({
          asset: a,
          address: entry.address,
          network: entry.network as Network,
          networkLabel: entry.networkLabel,
          managed: false,
        });
      }
    }

    // Which chains the user could additionally request, so the client can offer
    // a network selector without hardcoding the list.
    const networks = CRYPTO_NETWORKS.map((n) => ({
      network: n,
      label: NETWORK_LABELS[n] ?? String(n),
    }));

    return jsonOk({ addresses, networks });
  } catch (err) {
    return toErrorResponse(err);
  }
}
