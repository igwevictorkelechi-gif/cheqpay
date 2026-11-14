import { describe, expect, it } from "vitest";
import { LINK_CODE, botDeepLink, maskNumber, normaliseWaId } from "./session";

describe("normaliseWaId", () => {
  it("keeps one spelling for a number however it arrives", () => {
    // Meta sends E.164 without the +, but humans and other systems don't.
    expect(normaliseWaId("+234 801 234 5678")).toBe("2348012345678");
    expect(normaliseWaId("2348012345678")).toBe("2348012345678");
    expect(normaliseWaId("234-801-234-5678")).toBe("2348012345678");
  });

  it("returns empty for junk, so callers refuse rather than match loosely", () => {
    expect(normaliseWaId("not a number")).toBe("");
    expect(normaliseWaId("")).toBe("");
  });
});

describe("maskNumber", () => {
  it("never echoes the whole number back into a chat", () => {
    const masked = maskNumber("2348012345678");
    expect(masked).toBe("••• ••• 5678");
    expect(masked).not.toContain("234801");
  });

  it("does not leak a short number", () => {
    expect(maskNumber("123")).toBe("••••");
  });
});

describe("LINK_CODE", () => {
  it("accepts the alphabet codes are minted from", () => {
    expect(LINK_CODE.test("ABC234")).toBe(true);
    expect(LINK_CODE.test("XYZ789")).toBe(true);
  });

  it("rejects the characters left out to stop misreading", () => {
    // 0/O and 1/I/L are excluded precisely because these get read off one
    // screen and typed into another.
    for (const bad of ["ABC0DE", "ABCO1E", "ABCIDE", "ABCLDE"]) {
      expect(LINK_CODE.test(bad), bad).toBe(false);
    }
  });

  it("rejects the wrong length and lowercase", () => {
    expect(LINK_CODE.test("ABC23")).toBe(false);
    expect(LINK_CODE.test("ABC2345")).toBe(false);
    expect(LINK_CODE.test("abc234")).toBe(false);
  });
});

describe("botDeepLink", () => {
  it("is null until the bot number is configured", () => {
    delete process.env.WHATSAPP_BOT_NUMBER;
    expect(botDeepLink("ABC234")).toBeNull();
  });

  it("pre-types the LINK message", () => {
    process.env.WHATSAPP_BOT_NUMBER = "+234 801 234 5678";
    expect(botDeepLink("ABC234")).toBe("https://wa.me/2348012345678?text=LINK%20ABC234");
    delete process.env.WHATSAPP_BOT_NUMBER;
  });
});
