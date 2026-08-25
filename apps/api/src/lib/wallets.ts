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

/** What happened to one requested pair, so a failure can be shown, not just logged. */
export interface ProvisionOutcome {
  asset: Asset;
  network: Network;
  status: "created" | "existing" | "skipped" | "failed";
  address?: string;
  /** Provider/DB message when status is "failed" — the thing an operator needs. */
  error?: string;
}

export interface ProvisionReport {
  wallets: WalletView[];
  outcomes: ProvisionOutcome[];
  /** Set when nothing could be attempted at all (flag off, custody down). */
  blocked?: string;
}

/**
 * Provision the launch set of crypto wallets (BTC + USDT-TRC20) for a user.
 * Idempotent: existing wallets are left untouched, and address provisioning is
 * only called for missing asset/network pairs. Safe to call on every login.
 */
export async function provisionWallets(
  userId: string,
  pairs: ReadonlyArray<{ asset: Asset; network: Network }> = SUPPORTED_WALLETS,
  offramp?: boolean
): Promise<WalletView[]> {
  return (await provisionWalletsDetailed(userId, pairs, offramp)).wallets;
}

/**
 * Provision, reporting what happened to each pair.
 *
 * The plain `provisionWallets` swallows failures so a custody outage cannot
 * break the shared bootstrap path — which is right for a login, and useless for
 * an operator asking "why does this user have no address?". This variant keeps
 * the same tolerance but hands back the reason, so the admin tool and the
 * deposit-address endpoint can say what actually went wrong.
 */
export async function provisionWalletsDetailed(
  userId: string,
  /** Which pairs to mint. Defaults to the auto-provisioned launch set. */
  pairs: ReadonlyArray<{ asset: Asset; network: Network }> = SUPPORTED_WALLETS,
  /**
   * Convert arrivals to USD instead of crediting the coin. Off by default, so a
   * wallet holds real crypto; only Solana can be minted that way (it is the one
   * chain POST /crypto/transfer accepts). Pass true to mint on another chain.
   */
  offramp?: boolean
): Promise<ProvisionReport> {
  // While crypto deposits are switched off (compliance / provider blockers),
  // don't create on-chain addresses at all — an address nobody may use is
  // pure liability, and retry logging on every login is noise.
  const outcomes: ProvisionOutcome[] = [];
  const flags = await getFeatureFlags().catch(() => null);
  if (flags && !flags.crypto_deposits) {
    return {
      wallets: await listWallets(userId),
      outcomes,
      blocked: "crypto_deposits is off",
    };
  }

  // Refuse a pair we cannot mint rather than logging a failure per login.
  const wanted = pairs.filter((p) => isSupportedWallet(p.asset, p.network));
  for (const p of pairs) {
    if (!isSupportedWallet(p.asset, p.network)) {
      outcomes.push({
        asset: p.asset,
        network: p.network,
        status: "skipped",
        error: `${p.asset} on ${p.network} is not a mintable pair`,
      });
    }
  }
  if (wanted.length === 0) return { wallets: await listWallets(userId), outcomes };

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
    return {
      wallets: await listWallets(userId),
      outcomes,
      blocked: err instanceof Error ? err.message : "custody provider unavailable",
    };
  }

  for (const { asset, network } of wanted) {
    const existing = await prisma.wallet.findUnique({
      where: { userId_asset_network: { userId, asset, network } },
    });
    if (existing) {
      outcomes.push({ asset, network, status: "existing", address: existing.address });
      continue;
    }

    let provisioned: { address: string; custodyRef: string };
    try {
      provisioned = await custody.createDepositAddress({ userId, asset, network, offramp });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(
        `[wallets] custody provisioning failed for ${asset}/${network} (will retry)`,
        err
      );
      outcomes.push({ asset, network, status: "failed", error });
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
        outcomes.push({ asset, network, status: "existing" });
        continue;
      }
      // A write failure is worth reporting too, not throwing: the caller is
      // often a login path that must not fail over a crypto wallet.
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[wallets] could not store ${asset}/${network}`, err);
      outcomes.push({ asset, network, status: "failed", error });
      continue;
    }

    outcomes.push({ asset, network, status: "created", address: provisioned.address });
  }

  return { wallets: await listWallets(userId), outcomes };
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
