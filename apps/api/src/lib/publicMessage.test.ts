import { describe, expect, it } from "vitest";
import { scrubProviderNames } from "./publicMessage";

describe("scrubProviderNames", () => {
  it("drops the provider from a user-facing message", () => {
    expect(scrubProviderNames("BVN + name verified via Maplerad")).toBe("BVN + name verified");
    expect(scrubProviderNames("Maplerad returned status:false")).toBe("our provider returned status:false");
    expect(scrubProviderNames("Insufficient balance")).toBe("Insufficient balance");
  });

  it("knows the bills provider too", () => {
    expect(scrubProviderNames("Insufficient wallet balance on vtu.ng")).toBe("Insufficient wallet balance");
    expect(scrubProviderNames("vtu.ng declined the order")).toBe("our provider declined the order");
    expect(scrubProviderNames("Order not found on VTU.NG.")).toBe("Order not found.");
  });
});
