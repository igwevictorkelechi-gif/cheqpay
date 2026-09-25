import { describe, expect, it } from "vitest";
import { scrubProviderNames } from "./publicMessage";

describe("scrubProviderNames", () => {
  it("drops the provider from a user-facing message", () => {
    expect(scrubProviderNames("BVN + name verified via Maplerad")).toBe("BVN + name verified");
    expect(scrubProviderNames("Maplerad returned status:false")).toBe("our provider returned status:false");
    expect(scrubProviderNames("Insufficient balance")).toBe("Insufficient balance");
  });
});
