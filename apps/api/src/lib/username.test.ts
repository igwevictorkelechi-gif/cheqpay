import { describe, expect, it } from "vitest";
import { deriveUsernameBase } from "./username";

describe("deriveUsernameBase", () => {
  it("takes the email local part, lowercased", () => {
    expect(deriveUsernameBase("Victor@example.com")).toBe("victor");
  });

  it("strips characters a username may not contain", () => {
    // Dots and plus-addressing are legal in emails but not in handles.
    expect(deriveUsernameBase("first.last+tag@example.com")).toBe("firstlasttag");
  });

  it("keeps digits and underscores", () => {
    expect(deriveUsernameBase("bo_li99@example.com")).toBe("bo_li99");
  });

  it("truncates to the 20-character maximum", () => {
    const base = deriveUsernameBase("averyveryverylongemailaddress@example.com");
    expect(base).toHaveLength(20);
    expect(base).toBe("averyveryverylongema");
  });

  it("returns empty when nothing usable survives, so the caller can substitute", () => {
    // An all-symbol local part would otherwise produce an invalid handle.
    expect(deriveUsernameBase("...@example.com")).toBe("");
  });

  it("produces a value the profile schema would accept", () => {
    for (const email of ["ab@x.com", "user@x.com", "A_B_9@x.com"]) {
      const base = deriveUsernameBase(email);
      // Short bases are padded by the caller; what matters here is the
      // character set, which must never need escaping downstream.
      expect(base).toMatch(/^[a-z0-9_]*$/);
    }
  });
});
