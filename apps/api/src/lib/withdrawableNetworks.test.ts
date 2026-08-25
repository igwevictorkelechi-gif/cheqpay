import { describe, expect, it } from "vitest";
import { Asset, Network } from "@cheqpay/db";
import { COIN_CHAIN } from "@/custody/maplerad";
import { CRYPTO_NETWORKS, WITHDRAWABLE_NETWORKS, isWithdrawableNetwork } from "./assets";

/**
 * WITHDRAWABLE_NETWORKS is what the wallets route uses to decide whether a
 * requested chain must offramp. COIN_CHAIN's `withdrawable` column is what the
 * custody layer uses to refuse minting. They encode the same fact and are
 * written down twice, so this test is the thing that keeps them honest.
 *
 * If they drift, a chain could be minted as "holds real coin" while custody
 * knows it cannot be sent from — the exact trap the guard exists to prevent.
 */
describe("WITHDRAWABLE_NETWORKS agrees with custody's withdrawable column", () => {
  it("marks a chain withdrawable if and only if custody does", () => {
    for (const network of CRYPTO_NETWORKS) {
      const pair = COIN_CHAIN[Asset.USDC]?.[network];
      expect(pair, `USDC/${network} should exist in COIN_CHAIN`).toBeDefined();
      expect(
        isWithdrawableNetwork(network),
        `${network}: assets.ts and custody/maplerad.ts disagree`,
      ).toBe(pair!.withdrawable);
    }
  });

  it("is Solana only — the one chain POST /crypto/transfer accepts", () => {
    expect([...WITHDRAWABLE_NETWORKS]).toEqual([Network.SOLANA]);
  });

  it("holds for USDT as well as USDC", () => {
    for (const network of CRYPTO_NETWORKS) {
      const pair = COIN_CHAIN[Asset.USDT]?.[network];
      expect(isWithdrawableNetwork(network)).toBe(pair!.withdrawable);
    }
  });
});
