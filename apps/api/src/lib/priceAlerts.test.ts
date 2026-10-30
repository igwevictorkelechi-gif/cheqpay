import { describe, expect, it } from "vitest";
import { alertCrossed, prettyUsd } from "./priceAlerts";

describe("alertCrossed", () => {
  it("fires ABOVE at or past the target", () => {
    expect(alertCrossed("ABOVE", 70000, 70000)).toBe(true);
    expect(alertCrossed("ABOVE", 70000, 70001)).toBe(true);
    expect(alertCrossed("ABOVE", 70000, 69999)).toBe(false);
  });

  it("fires BELOW at or under the target", () => {
    expect(alertCrossed("BELOW", 60000, 60000)).toBe(true);
    expect(alertCrossed("BELOW", 60000, 59999)).toBe(true);
    expect(alertCrossed("BELOW", 60000, 60001)).toBe(false);
  });

  it("never fires on an unknown direction or non-finite inputs", () => {
    expect(alertCrossed("SIDEWAYS", 1, 1)).toBe(false);
    expect(alertCrossed("ABOVE", NaN, 1)).toBe(false);
    expect(alertCrossed("ABOVE", 1, Infinity)).toBe(false);
  });
});

describe("prettyUsd", () => {
  it("drops decimals for large prices and keeps them for small ones", () => {
    expect(prettyUsd(68234.5)).toBe("$68,235");
    expect(prettyUsd(1.2345)).toBe("$1.2345");
  });
});
