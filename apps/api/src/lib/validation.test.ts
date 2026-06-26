import { describe, expect, it } from "vitest";
import { kycTier1Schema, platformSettingsUpdateSchema } from "./validation";

describe("kycTier1Schema", () => {
  it("accepts valid input and defaults country/documentRefs", () => {
    const parsed = kycTier1Schema.parse({
      fullName: "Ada Lovelace",
      dateOfBirth: "1990-12-10",
    });
    expect(parsed.country).toBe("NG");
    expect(parsed.documentRefs).toEqual([]);
  });

  it("rejects a malformed date", () => {
    expect(() =>
      kycTier1Schema.parse({ fullName: "Ada", dateOfBirth: "10/12/1990" })
    ).toThrow();
  });

  it("rejects a too-short name", () => {
    expect(() =>
      kycTier1Schema.parse({ fullName: "A", dateOfBirth: "1990-12-10" })
    ).toThrow();
  });
});

describe("platformSettingsUpdateSchema", () => {
  it("accepts a spread-only update", () => {
    expect(platformSettingsUpdateSchema.parse({ spreadBps: 200 })).toEqual({
      spreadBps: 200,
    });
  });

  it("accepts a rate-only update", () => {
    expect(platformSettingsUpdateSchema.parse({ usdtNgnRate: 1800 })).toEqual({
      usdtNgnRate: 1800,
    });
  });

  it("rejects an empty update", () => {
    expect(() => platformSettingsUpdateSchema.parse({})).toThrow();
  });

  it("rejects out-of-range spread", () => {
    expect(() => platformSettingsUpdateSchema.parse({ spreadBps: 10_001 })).toThrow();
    expect(() => platformSettingsUpdateSchema.parse({ spreadBps: -1 })).toThrow();
  });

  it("rejects a non-positive rate", () => {
    expect(() => platformSettingsUpdateSchema.parse({ usdtNgnRate: 0 })).toThrow();
  });
});
