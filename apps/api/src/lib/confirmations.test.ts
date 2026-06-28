import { describe, expect, it } from "vitest";
import { Network } from "@cheqpay/db";
import { MIN_CONFIRMATIONS, isConfirmed } from "./confirmations";

describe("isConfirmed", () => {
  it("treats a missing confirmation count as confirmed (provider-side threshold)", () => {
    expect(isConfirmed(Network.BITCOIN, undefined)).toBe(true);
  });

  it("requires the per-network minimum when a count is present", () => {
    const min = MIN_CONFIRMATIONS[Network.BITCOIN];
    expect(isConfirmed(Network.BITCOIN, min - 1)).toBe(false);
    expect(isConfirmed(Network.BITCOIN, min)).toBe(true);
    expect(isConfirmed(Network.BITCOIN, min + 5)).toBe(true);
  });

  it("applies TRON's higher threshold", () => {
    expect(isConfirmed(Network.TRON, 5)).toBe(false);
    expect(isConfirmed(Network.TRON, MIN_CONFIRMATIONS[Network.TRON])).toBe(true);
  });
});
