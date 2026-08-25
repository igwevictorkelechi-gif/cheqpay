import { describe, expect, it } from "vitest";
import {
  cryptoWithdrawalSchema,
  ngnWithdrawalSchema,
  userTransferSchema,
} from "./validation";

/**
 * USD payouts are deliberately not live: users hold dollars and convert them,
 * but cannot withdraw them anywhere. The clients route a USD "Withdraw" tap to
 * the convert screen, and these schemas are what make that a guarantee rather
 * than a UI convention — no request can express a USD payout.
 *
 * This test exists so that adding "USD" to one of these enums fails loudly here
 * instead of quietly opening an unfunded payout rail.
 */
describe("USD cannot be withdrawn or sent", () => {
  it("the crypto withdrawal schema rejects USD", () => {
    const r = cryptoWithdrawalSchema.safeParse({
      asset: "USD",
      network: "ETHEREUM",
      toAddress: "0x00000000000000000000000000",
      amount: "10",
    });
    expect(r.success).toBe(false);
  });

  it("the crypto withdrawal schema still accepts the live crypto assets", () => {
    for (const asset of ["USDT", "USDC"]) {
      const r = cryptoWithdrawalSchema.safeParse({
        asset,
        network: "ETHEREUM",
        toAddress: "0x00000000000000000000000000",
        amount: "10",
      });
      expect(r.success, `${asset} should be withdrawable`).toBe(true);
    }
  });

  it("the NGN payout schema has no asset to point at USD", () => {
    // It is NGN by construction: a bank code + NUBAN, no currency field.
    const r = ngnWithdrawalSchema.safeParse({
      amount: "1000",
      bankCode: "058",
      accountNumber: "0123456789",
      asset: "USD",
    });
    expect(r.success).toBe(true);
    expect(r.success && "asset" in r.data).toBe(false);
  });

  it("user-to-user transfers reject USD", () => {
    const r = userTransferSchema.safeParse({
      username: "victor",
      asset: "USD",
      amount: "10",
    });
    expect(r.success).toBe(false);
  });
});
