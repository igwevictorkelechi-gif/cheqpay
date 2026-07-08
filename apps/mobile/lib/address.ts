/** Lightweight crypto-address shape checks for clipboard detection & hints.
 *  Format-only (no checksum) — used to OFFER a paste, never to validate a send;
 *  the backend remains the source of truth. */
export type CryptoNetwork = 'BITCOIN' | 'TRON' | 'ETHEREUM' | 'BSC';

const PATTERNS: Record<CryptoNetwork, RegExp> = {
  BITCOIN: /^(bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
  TRON: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  ETHEREUM: /^0x[a-fA-F0-9]{40}$/,
  BSC: /^0x[a-fA-F0-9]{40}$/,
};

export function isAddressForNetwork(text: string, network: string): boolean {
  const re = PATTERNS[network as CryptoNetwork];
  return !!re && re.test(text.trim());
}

/** Shorten an address for display: bc1qab…3kf9 */
export function shortAddress(addr: string, head = 10, tail = 8): string {
  const a = addr.trim();
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}
