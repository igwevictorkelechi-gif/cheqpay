import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  getEnv: () => ({ ADMIN_API_SECRET: "test-admin-secret-value", API_PUBLIC_URL: "https://api.example.com/" }),
}));
vi.mock("@cheqpay/db", () => ({ prisma: {} }));

import { mediaProxyUrl, verifyMediaSig } from "./mediaProxy";
import { pkcePair, safeReturnUrl } from "./oauth";

describe("signed media links", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  it("verifies its own link", () => {
    const u = new URL(mediaProxyUrl(id, 1_000_000_000_000));
    expect(u.origin + u.pathname).toBe(`https://api.example.com/api/social/media/${id}`);
    expect(verifyMediaSig(id, u.searchParams.get("exp"), u.searchParams.get("sig"), 1_000_000_000_000)).toBe(true);
  });

  it("refuses another file, a tampered signature, or an expired link", () => {
    const u = new URL(mediaProxyUrl(id, 1_000_000_000_000));
    const exp = u.searchParams.get("exp");
    const sig = u.searchParams.get("sig");
    expect(verifyMediaSig("99999999-2222-3333-4444-555555555555", exp, sig, 1_000_000_000_000)).toBe(false);
    expect(verifyMediaSig(id, exp, `${sig}x`, 1_000_000_000_000)).toBe(false);
    expect(verifyMediaSig(id, exp, sig, 1_000_000_000_000 + 3 * 3600_000)).toBe(false);
    expect(verifyMediaSig(id, null, sig)).toBe(false);
  });
});

describe("OAuth helpers", () => {
  it("makes an S256 PKCE pair", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("only returns admins to an https dashboard", () => {
    expect(safeReturnUrl("https://cheqpay-admin.vercel.app")).toBe("https://cheqpay-admin.vercel.app/social/accounts");
    expect(() => safeReturnUrl("http://evil.example")).toThrow();
    expect(() => safeReturnUrl("javascript:alert(1)")).toThrow();
    expect(() => safeReturnUrl(null)).toThrow();
  });
});
