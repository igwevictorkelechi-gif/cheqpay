import { Asset, Network } from "@cheqpay/db";

/**
 * Crypto wallets provisioned for every user at launch. Asset/network are
 * modeled as data so adding BEP-20 / ERC-20 later is a one-line change here
 * plus the matching enum value.
 */
export const SUPPORTED_WALLETS: ReadonlyArray<{ asset: Asset; network: Network }> = [
  { asset: Asset.BTC, network: Network.BITCOIN },
  { asset: Asset.USDT, network: Network.TRON }, // TRC-20 (default)
];

export function isSupportedWallet(asset: Asset, network: Network): boolean {
  return SUPPORTED_WALLETS.some((w) => w.asset === asset && w.network === network);
}
