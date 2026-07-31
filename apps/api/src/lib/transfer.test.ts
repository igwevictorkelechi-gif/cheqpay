import { describe, expect, it } from "vitest";
import { userTransferSchema } from "./validation";
import { toMinorUnits } from "./money";

describe("userTransferSchema", () => {
  const base = { username: "victor", asset: "NGN" as const, amount: "1000" };

  it("strips a leading @ so both @victor and victor work", () => {
    expect(userTransferSchema.parse({ ...base, username: "@victor" }).username).toBe("victor");
    expect(userTransferSchema.parse({ ...base, username: "@@victor" }).username).toBe("victor");
  });

  it("rejects usernames that could not exist", () => {
    for (const username of ["ab", "a".repeat(21), "has space", "bad-dash", "emoji🙂"]) {
      expect(() => userTransferSchema.parse({ ...base, username })).toThrow();
    }
  });

  it("rejects non-numeric or negative amounts", () => {
    for (const amount of ["", "abc", "-5", "1,000", "1.2.3"]) {
      expect(() => userTransferSchema.parse({ ...base, amount })).toThrow();
    }
  });

  it("accepts every supported asset and rejects unknown ones", () => {
    for (const asset of ["NGN", "BTC", "USDT", "USDC"]) {
      expect(userTransferSchema.parse({ ...base, asset }).asset).toBe(asset);
    }
    expect(() => userTransferSchema.parse({ ...base, asset: "DOGE" })).toThrow();
  });

  it("caps the note length", () => {
    expect(() => userTransferSchema.parse({ ...base, note: "x".repeat(141) })).toThrow();
    expect(userTransferSchema.parse({ ...base, note: "x".repeat(140) }).note).toHaveLength(140);
  });
});

describe("transfer amounts", () => {
  it("converts to the asset's minor units without floating point", () => {
    expect(toMinorUnits("1000", "NGN")).toBe(100_000n); // kobo
    expect(toMinorUnits("0.5", "BTC")).toBe(50_000_000n); // satoshis
    expect(toMinorUnits("10.25", "USDT")).toBe(10_250_000n); // 6dp
  });

  it("keeps sub-unit precision that a float would lose", () => {
    // 0.1 + 0.2 style error would show up here if we used numbers.
    expect(toMinorUnits("0.07", "NGN")).toBe(7n);
    expect(toMinorUnits("1234567.89", "NGN")).toBe(123_456_789n);
  });
});
