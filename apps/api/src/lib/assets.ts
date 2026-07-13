import { Asset, Network } from "@cheqpay/db";

/**
 * Crypto wallets provisioned for every user. Asset/network are modeled as data
 * so adding a pair later is a one-line change here plus the matching enum value.
 *
 * The set mirrors what Maplerad custody can actually mint (verified against
 * their API): USDT and USDC on Ethereum (ERC-20). TRON is not offered by
 * Maplerad's address API, and BTC has no custodian at all — it stays "coming
 * soon" in the clients and is deliberately NOT provisioned, so users can never
 * see a BTC address nobody is watching.
 */
export const SUPPORTED_WALLETS: ReadonlyArray<{ asset: Asset; network: Network }> = [
  { asset: Asset.USDT, network: Network.ETHEREUM }, // ERC-20
  { asset: Asset.USDC, network: Network.ETHEREUM }, // ERC-20
];

export function isSupportedWallet(asset: Asset, network: Network): boolean {
  return SUPPORTED_WALLETS.some((w) => w.asset === asset && w.network === network);
}
