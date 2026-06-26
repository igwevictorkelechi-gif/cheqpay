import { Asset, Network, Prisma, prisma } from "@cheqpay/db";
import { getCustodyProvider } from "@/custody";
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
  const custody = getCustodyProvider();

  for (const { asset, network } of SUPPORTED_WALLETS) {
    const existing = await prisma.wallet.findUnique({
      where: { userId_asset_network: { userId, asset, network } },
    });
    if (existing) continue;

    const { address, custodyRef } = await custody.createDepositAddress({
      userId,
      asset,
      network,
    });

    try {
      await prisma.wallet.create({
        data: { userId, asset, network, address, custodyRef },
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
