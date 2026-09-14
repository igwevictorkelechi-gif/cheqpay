import { describe, expect, it } from "vitest";
import { getBiller, getAllBillers } from "./bills";

/**
 * Data purchases failed with "request failed" while the bundle list, the bundle
 * code and the price were all correct, because the identifier that LISTS a
 * network's bundles is not the one that BUYS one.
 */
describe("the identifier a bill is paid with", () => {
  it("buys data on the network id, not the catalog slug", () => {
    const airtel = getBiller("data", "airtel")!;
    expect(airtel.mapleradId).toBe("airtel-data-ng"); // lists the bundles
    expect(airtel.mapleradPayId).toBe("airtel-ng"); // buys one
  });

  it("gives every data network a purchase id that drops the -data- segment", () => {
    for (const id of ["mtn", "airtel", "glo", "9mobile"]) {
      const b = getBiller("data", id)!;
      expect(b.mapleradId).toContain("-data-");
      expect(b.mapleradPayId).toBe(`${id}-ng`);
      expect(b.mapleradPayId).not.toContain("-data-");
    }
  });

  it("matches the airtime identifier for the same network", () => {
    // Airtime on airtel-ng is the one purchase we have seen succeed in
    // production, so data buying on the same identifier is the whole point.
    expect(getBiller("data", "airtel")!.mapleradPayId).toBe(
      getBiller("airtime", "airtel")!.mapleradId,
    );
  });

  it("leaves every other service paying on the id it already used", () => {
    for (const b of getAllBillers()) {
      if (b.service === "data") continue;
      expect(b.mapleradPayId).toBeUndefined();
    }
  });
});
