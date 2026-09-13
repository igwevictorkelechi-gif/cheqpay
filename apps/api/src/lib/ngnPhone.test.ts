import { describe, expect, it } from "vitest";
import { normaliseNgnPhone, phoneForProvider } from "./ngnPhone";

describe("normaliseNgnPhone", () => {
  it("reduces every spelling of the same line to the local form", () => {
    for (const given of [
      "07014998301",
      "0701 499 8301",
      "0701-499-8301",
      "+2347014998301",
      "+234 701 499 8301",
      "2347014998301",
      "7014998301",
      "  07014998301  ",
    ]) {
      expect(normaliseNgnPhone(given)).toBe("07014998301");
    }
  });

  it("refuses what is not a Nigerian mobile", () => {
    expect(normaliseNgnPhone("0601499830")).toBeNull(); // wrong prefix
    expect(normaliseNgnPhone("070149983")).toBeNull(); // too short
    expect(normaliseNgnPhone("070149983011")).toBeNull(); // too long
    expect(normaliseNgnPhone("not a number")).toBeNull();
    expect(normaliseNgnPhone("")).toBeNull();
    expect(normaliseNgnPhone(null)).toBeNull();
  });
});

describe("phoneForProvider", () => {
  it("normalises what it recognises", () => {
    expect(phoneForProvider("+234 701 499 8301")).toBe("07014998301");
  });

  it("passes an unrecognised number through rather than blocking the purchase", () => {
    // The provider gets the final say; refusing here would fail a purchase we
    // might otherwise have made.
    expect(phoneForProvider(" 08001234 ")).toBe("08001234");
  });
});
