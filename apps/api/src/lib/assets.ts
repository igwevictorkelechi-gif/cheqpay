import { Asset, Network } from "@cheqpay/db";

/**
 * Every asset/network pair Maplerad custody can mint an address for: USDT and
 * USDC across the six chains POST /crypto documents. BTC has no custodian at
 * all — it stays "coming soon" in the clients and is deliberately absent, so
 * users can never see a BTC address nobody is watching.
 */
export const CRYPTO_NETWORKS: ReadonlyArray<Network> = [
  Network.SOLANA,
  Network.BASE,
  Network.POLYGON,
  Network.ETHEREUM,
  Network.TRON,
  Network.BSC,
];

export const CRYPTO_COINS: ReadonlyArray<Asset> = [Asset.USDT, Asset.USDC];

/** Every mintable pair — what a user may request on demand. */
export const AVAILABLE_WALLETS: ReadonlyArray<{ asset: Asset; network: Network }> =
  CRYPTO_COINS.flatMap((asset) => CRYPTO_NETWORKS.map((network) => ({ asset, network })));

/**
 * The pairs provisioned automatically for every user.
 *
 * Deliberately just Solana: it is the one chain Maplerad documents for
 * withdrawal as well as deposit, so it is the only pair that works whether or
 * not the deposit is offramped. Minting all twelve pairs up front would hand
 * every user a wall of addresses they did not ask for; the other chains are
 * available on demand through POST /api/wallets.
 */
export const SUPPORTED_WALLETS: ReadonlyArray<{ asset: Asset; network: Network }> = [
  { asset: Asset.USDT, network: Network.SOLANA },
  { asset: Asset.USDC, network: Network.SOLANA },
];

/** Is this pair one we can mint at all (not just one we auto-provision)? */
export function isSupportedWallet(asset: Asset, network: Network): boolean {
  return AVAILABLE_WALLETS.some((w) => w.asset === asset && w.network === network);
}
