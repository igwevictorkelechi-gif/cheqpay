import { Asset, Network, Prisma, prisma } from "@cheqpay/db";
import { getCustodyProvider } from "@/custody";
import { getFeatureFlags } from "./features";
import { SUPPORTED_WALLETS } from "./assets";

export interface WalletView {
  asset: Asset;
  network: Network;
  address: string;
}

/**
 * Provision the launch set of crypto wallets (BTC + USDT-TRC20) for a user.
 * Idempotent: existing wallets are left untouched, and address provisioning is
 * only called for missing asset/network pairs. Safe to call on every login.
 */
export async function provisionWallets(userId: string): Promise<WalletView[]> {
  // While crypto deposits are switched off (compliance / provider blockers),
  // don't create on-chain addresses at all — an address nobody may use is
  // pure liability, and retry logging on every login is noise.
  const flags = await getFeatureFlags().catch(() => null);
  if (flags && !flags.crypto_deposits) return listWallets(userId);

  // A custody misconfiguration/outage must not fail the whole provisioning
  // pass — that would break every flow that bootstraps via ensureProvisioned
  // (NGN deposits included). Crypto wallets are simply retried on the next
  // call; the receive screen shows "address not available yet" meanwhile.
  let custody;
  try {
    custody = getCustodyProvider();
  } catch (err) {
    console.error("[wallets] custody provider unavailable (skipping crypto provisioning)", err);
    return listWallets(userId);
  }

  for (const { asset, network } of SUPPORTED_WALLETS) {
    const existing = await prisma.wallet.findUnique({
      where: { userId_asset_network: { userId, asset, network } },
    });
    if (existing) continue;

    let provisioned: { address: string; custodyRef: string };
    try {
      provisioned = await custody.createDepositAddress({ userId, asset, network });
    } catch (err) {
      console.error(
        `[wallets] custody provisioning failed for ${asset}/${network} (will retry)`,
        err
      );
      continue;
    }

    try {
      await prisma.wallet.create({
        data: { userId, asset, network, ...provisioned },
      });
    } catch (err) {
      // Tolerate a concurrent create (unique violation) — another request won.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }

  return listWallets(userId);
}

export async function listWallets(userId: string): Promise<WalletView[]> {
  const wallets = await prisma.wallet.findMany({
    where: { userId },
    select: { asset: true, network: true, address: true },
    orderBy: [{ asset: "asc" }, { network: "asc" }],
  });
  return wallets;
}
