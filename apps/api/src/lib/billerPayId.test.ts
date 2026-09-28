import { describe, expect, it } from "vitest";
import { getBiller, getAllBillers } from "./bills";

/**
 * Which identifier a bill is bought with. Data briefly bought on the bare
 * network id (`airtel-ng`); Maplerad answered every such purchase with 400
 * "invalid service identifier". Data buys on its `*-data-ng` id.
 */
describe("the identifier a bill is paid with", () => {
  it("buys data on the same *-data-ng id that lists the bundles", () => {
    for (const id of ["mtn", "airtel", "glo", "9mobile"]) {
      const b = getBiller("data", id)!;
      expect(b.mapleradId).toBe(`${id}-data-ng`);
      // What the pay route sends: the pay id when set, else the list id.
      expect(b.mapleradPayId ?? b.mapleradId).toBe(`${id}-data-ng`);
    }
  });

  it("never buys data on the bare network id Maplerad rejected", () => {
    const airtel = getBiller("data", "airtel")!;
    expect(airtel.mapleradPayId ?? airtel.mapleradId).not.toBe("airtel-ng");
  });

  it("leaves airtime on the network id it succeeds with", () => {
    expect(getBiller("airtime", "airtel")!.mapleradId).toBe("airtel-ng");
  });

  it("sets no separate purchase id on any biller", () => {
    for (const b of getAllBillers()) expect(b.mapleradPayId).toBeUndefined();
  });
});
