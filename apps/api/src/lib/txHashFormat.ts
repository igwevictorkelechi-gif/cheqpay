// apps/api/src/lib/txHashFormat.ts
//
// Is this string even shaped like a transaction hash on that chain?
//
// Admin actions that record an on-chain transfer — crediting a manual deposit,
// marking a manual withdrawal paid — take the hash as their evidence. On 22 Sep
// a deposit was "credited" with the hash "ptprobed0f5ac83", which is not a
// transaction on any chain. A shape check cannot prove a transfer happened, but
// it does stop the evidence being made up on the spot.

import { Network } from "@cheqpay/db";

const HEX64 = /^[0-9a-fA-F]{64}$/;
const EVM = /^0x[0-9a-fA-F]{64}$/;
// Solana signatures are base58, 64 bytes -> 86-88 characters in practice.
const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

export function isPlausibleTxHash(network: Network | string | null | undefined, hash: string): boolean {
  const h = hash.trim();
  switch (network) {
    case Network.ETHEREUM:
    case Network.BSC:
    case Network.POLYGON:
    case Network.BASE:
      return EVM.test(h);
    case Network.BITCOIN:
    case Network.TRON:
      return HEX64.test(h) || HEX64.test(h.replace(/^0x/, ""));
    case Network.SOLANA:
      return BASE58_SIG.test(h);
    default:
      // Unknown network: accept any of the real shapes, never free text.
      return EVM.test(h) || HEX64.test(h) || BASE58_SIG.test(h);
  }
}
