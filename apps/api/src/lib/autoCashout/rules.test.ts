import { describe, expect, it } from "vitest";
import { ApiError } from "../http";
import { classifyError, depositCoin, maskedAccount, retryDelaySeconds, shouldQueue } from "./rules";

describe("depositCoin", () => {
  it("takes coins credited as themselves", () => {
    expect(depositCoin("USDT", {})).toBe("USDT");
    expect(depositCoin("BTC", null)).toBe("BTC");
  });
  it("matches an off-ramped stablecoin (credited as dollars) by the coin that was sent", () => {
    expect(depositCoin("USD", { offramp: true, coin: "USDC" })).toBe("USDC");
    expect(depositCoin("USD", { coin: "usdt" })).toBe("USDT");
  });
  it("never cashes out naira, plain dollars or unknown coins", () => {
    expect(depositCoin("NGN", { coin: "USDT" })).toBeNull();
    expect(depositCoin("USD", {})).toBeNull();
    expect(depositCoin("USD", { offramp: true, coin: "ETH" })).toBeNull();
  });
});

describe("shouldQueue", () => {
  const on = { enabled: true, assets: ["USDT"], beneficiaryId: "b1" };
  it("queues only a ticked coin, when on, with a bank account", () => {
    expect(shouldQueue(on, "USDT")).toBe(true);
    expect(shouldQueue(on, "BTC")).toBe(false);
    expect(shouldQueue({ ...on, enabled: false }, "USDT")).toBe(false);
    expect(shouldQueue({ ...on, beneficiaryId: null }, "USDT")).toBe(false);
    expect(shouldQueue(null, "USDT")).toBe(false);
    expect(shouldQueue(on, null)).toBe(false);
  });
});

describe("classifyError", () => {
  it("retries what may work later", () => {
    expect(classifyError(new ApiError(502, "x", "fx_quote_failed"))).toBe("retry");
    expect(classifyError(new ApiError(502, "x", "payout_failed"))).toBe("retry");
    expect(classifyError(new Error("ECONNRESET"))).toBe("retry");
  });
  it("stops on a definite answer", () => {
    expect(classifyError(new ApiError(403, "x", "daily_limit"))).toBe("stop");
    expect(classifyError(new ApiError(422, "x", "name_mismatch"))).toBe("stop");
    expect(classifyError(new ApiError(422, "x", "insufficient_funds"))).toBe("stop");
  });
  it("never retries where money may have moved unrecorded", () => {
    expect(classifyError(new ApiError(500, "x", "fx_credit_failed"))).toBe("danger");
  });
});

describe("misc", () => {
  it("backs off 2 min, 10 min, 1 h, then 6 h", () => {
    expect([1, 2, 3, 4, 9].map(retryDelaySeconds)).toEqual([120, 600, 3600, 21_600, 21_600]);
  });
  it("masks the account number", () => {
    expect(maskedAccount("GTBank", "0123456789")).toBe("GTBank ••6789");
  });
});
