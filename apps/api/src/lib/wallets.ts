import { Asset, Network, Prisma, prisma } from "@cheqpay/db";
import { getCustodyProvider } from "@/custody";
import { getFeatureFlags } from "./features";
import { isSupportedWallet, SUPPORTED_WALLETS } from "./assets";
import { ensureNetworks } from "./ensureNetworks";

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
export async function provisionWallets(
  userId: string,
  /** Which pairs to mint. Defaults to the auto-provisioned launch set. */
  pairs: ReadonlyArray<{ asset: Asset; network: Network }> = SUPPORTED_WALLETS,
  /**
   * Convert arrivals to USD instead of crediting the coin. Off by default, so a
   * wallet holds real crypto; only Solana can be minted that way (it is the one
   * chain POST /crypto/transfer accepts). Pass true to mint on another chain.
   */
  offramp?: boolean
): Promise<WalletView[]> {
  // While crypto deposits are switched off (compliance / provider blockers),
  // don't create on-chain addresses at all — an address nobody may use is
  // pure liability, and retry logging on every login is noise.
  const flags = await getFeatureFlags().catch(() => null);
  if (flags && !flags.crypto_deposits) return listWallets(userId);

  // Refuse a pair we cannot mint rather than logging a failure per login.
  const wanted = pairs.filter((p) => isSupportedWallet(p.asset, p.network));
  if (wanted.length === 0) return listWallets(userId);

  // The Network enum values must exist before any typed write names them.
  await ensureNetworks();

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

  for (const { asset, network } of wanted) {
    const existing = await prisma.wallet.findUnique({
      where: { userId_asset_network: { userId, asset, network } },
    });
    if (existing) continue;

    let provisioned: { address: string; custodyRef: string };
    try {
      provisioned = await custody.createDepositAddress({ userId, asset, network, offramp });
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

/**
 * The user's CRYPTO deposit wallets.
 *
 * Fiat virtual accounts (the NGN NUBAN and the USD account) are stored as Wallet
 * rows too — same table, network = FIAT — so an unfiltered read would hand back
 * a bank account number as if it were an on-chain deposit address. Excluding
 * FIAT keeps this endpoint meaning what its name says, and stays correct as new
 * crypto assets are added.
 */
export async function listWallets(userId: string): Promise<WalletView[]> {
  const wallets = await prisma.wallet.findMany({
    where: { userId, network: { not: Network.FIAT } },
    select: { asset: true, network: true, address: true },
    orderBy: [{ asset: "asc" }, { network: "asc" }],
  });
  return wallets;
}
