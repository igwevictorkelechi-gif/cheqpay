import { Network } from "@cheqpay/db";

/**
 * Minimum on-chain confirmations before a deposit is credited. If a provider
 * webhook omits a confirmation count (because the subscription is already
 * configured to fire only at the threshold), we treat it as confirmed.
 */
export const MIN_CONFIRMATIONS: Record<Network, number> = {
  [Network.BITCOIN]: 2,
  [Network.TRON]: 20,
  [Network.BSC]: 15,
  [Network.ETHEREUM]: 12,
  [Network.FIAT]: 0,
};

export function isConfirmed(network: Network, confirmations?: number): boolean {
  if (confirmations === undefined) return true;
  return confirmations >= (MIN_CONFIRMATIONS[network] ?? 0);
}
