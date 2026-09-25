import { describe, expect, it } from "vitest";
import { matchesSignature } from "./fileSignature";

describe("matchesSignature", () => {
  it("accepts real JPEG and PNG headers", () => {
    expect(matchesSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "image/jpeg")).toBe(true);
    expect(
      matchesSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "image/png"),
    ).toBe(true);
  });

  it("refuses HTML or a script dressed up as an image", () => {
    expect(matchesSignature(Buffer.from("<html><script>alert(1)</script>"), "image/jpeg")).toBe(false);
    expect(matchesSignature(Buffer.from("<svg onload=alert(1)>"), "image/png")).toBe(false);
  });

  it("refuses a type it doesn't know", () => {
    expect(matchesSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "text/html")).toBe(false);
  });
});
