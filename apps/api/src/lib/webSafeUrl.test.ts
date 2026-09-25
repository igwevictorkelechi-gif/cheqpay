import { describe, expect, it } from "vitest";
import { safeHttpsUrl, safeInternalPath } from "../../../web/src/lib/safeUrl";

describe("website link guards", () => {
  it("keeps real in-site paths", () => {
    expect(safeInternalPath("/usd-account")).toBe("/usd-account");
    expect(safeInternalPath("/deposit?currency=USD#top")).toBe("/deposit?currency=USD#top");
  });

  it("refuses anything that leaves the site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "", null]) {
      expect(safeInternalPath(bad as string | null), String(bad)).toBeNull();
    }
  });

  it("only lets https links into an href", () => {
    expect(safeHttpsUrl("https://partner.example/consent")).toBe("https://partner.example/consent");
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("data:text/html,<script>")).toBeNull();
    expect(safeHttpsUrl("http://plain.example")).toBeNull();
  });
});
