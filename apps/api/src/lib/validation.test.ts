import { describe, expect, it } from "vitest";
import { kycTier1Schema, platformSettingsUpdateSchema } from "./validation";

// A valid government ID — required on every submission now.
const identity = {
  type: "NIN" as const,
  number: "12345678901",
  frontRef: "kyc/u1/front.jpg",
  backRef: "kyc/u1/back.jpg",
};

describe("kycTier1Schema", () => {
  it("accepts valid input and defaults country/documentRefs", () => {
    const parsed = kycTier1Schema.parse({
      firstName: "Ada",
      lastName: "Lovelace",
      dateOfBirth: "1990-12-10",
      identity,
    });
    expect(parsed.country).toBe("NG");
    expect(parsed.documentRefs).toEqual([]);
    expect(parsed.identity.type).toBe("NIN");
    // phone/address are optional — old clients omit them.
    expect(parsed.phone).toBeUndefined();
    expect(parsed.address).toBeUndefined();
  });

  it("accepts the optional phone + address used for Maplerad enrollment", () => {
    const parsed = kycTier1Schema.parse({
      firstName: "Ada",
      lastName: "Lovelace",
      dateOfBirth: "1990-12-10",
      identity,
      phone: "08031234567",
      address: { street: "12 Marina Rd", city: "Lagos", state: "Lagos", postalCode: "100001" },
    });
    expect(parsed.address?.city).toBe("Lagos");
  });

  it("rejects a submission with no government ID — it is now mandatory", () => {
    expect(() =>
      kycTier1Schema.parse({ firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-12-10" })
    ).toThrow();
  });

  it("rejects an unknown ID type", () => {
    expect(() =>
      kycTier1Schema.parse({
        firstName: "Ada",
        lastName: "Lovelace",
        dateOfBirth: "1990-12-10",
        identity: { ...identity, type: "SSN" },
      })
    ).toThrow();
  });

  it("rejects an ID with a missing image ref", () => {
    expect(() =>
      kycTier1Schema.parse({
        firstName: "Ada",
        lastName: "Lovelace",
        dateOfBirth: "1990-12-10",
        identity: { ...identity, backRef: "" },
      })
    ).toThrow();
  });

  it("rejects a malformed date", () => {
    expect(() =>
      kycTier1Schema.parse({ firstName: "Ada", lastName: "Lovelace", dateOfBirth: "10/12/1990", identity })
    ).toThrow();
  });

  it("rejects a submission with no date of birth — it is now mandatory", () => {
    expect(() =>
      kycTier1Schema.parse({ firstName: "Ada", lastName: "Lovelace", identity })
    ).toThrow();
  });

  it("rejects a too-short name", () => {
    expect(() =>
      kycTier1Schema.parse({ firstName: "A", lastName: "Lovelace", dateOfBirth: "1990-12-10", identity })
    ).toThrow();
  });

  it("rejects a partial address rather than enrolling with holes", () => {
    expect(() =>
      kycTier1Schema.parse({
        firstName: "Ada",
        lastName: "Lovelace",
        dateOfBirth: "1990-12-10",
        identity,
        address: { street: "12 Marina Rd", city: "Lagos" },
      })
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
