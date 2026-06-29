import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { isAdminUser, requireMfa, verifySupabaseJwt } from "./auth";
import { AuthError, ForbiddenError } from "./http";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);
}

/** A decode-only token (signature irrelevant — Supabase validates, we just read aal). */
async function tokenWith(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("decode-only-secret-decode-only"));
}

afterEach(() => vi.unstubAllGlobals());

describe("verifySupabaseJwt", () => {
  it("returns the user when Supabase validates the token", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { id: "u1", email: "a@b.com", phone: "+234800" }));
    const token = await tokenWith({ sub: "u1", aal: "aal1" });
    const u = await verifySupabaseJwt(token);
    expect(u.id).toBe("u1");
    expect(u.email).toBe("a@b.com");
    expect(u.aal).toBe("aal1");
    expect(u.isAdmin).toBe(false);
  });

  it("rejects a token Supabase does not accept", async () => {
    vi.stubGlobal("fetch", mockFetch(401, { error: "bad_jwt" }));
    const token = await tokenWith({ sub: "u1" });
    await expect(verifySupabaseJwt(token)).rejects.toBeInstanceOf(AuthError);
  });

  it("derives isAdmin from app_metadata.role and reads aal2", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { id: "u1", app_metadata: { role: "admin" } }));
    const token = await tokenWith({ sub: "u1", aal: "aal2" });
    const u = await verifySupabaseJwt(token);
    expect(u.isAdmin).toBe(true);
    expect(u.aal).toBe("aal2");
  });

  it("throws when the response has no user id", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {}));
    const token = await tokenWith({ sub: "x" });
    await expect(verifySupabaseJwt(token)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("requireMfa", () => {
  it("passes for aal2", () => {
    expect(() => requireMfa({ id: "u", aal: "aal2" })).not.toThrow();
  });
  it("rejects aal1 / missing aal", () => {
    expect(() => requireMfa({ id: "u", aal: "aal1" })).toThrow(ForbiddenError);
    expect(() => requireMfa({ id: "u" })).toThrow(ForbiddenError);
  });
});

describe("isAdminUser", () => {
  it("recognizes the admin role claim", () => {
    expect(isAdminUser({ id: "u", isAdmin: true })).toBe(true);
  });
  it("denies a normal user (no role, not in allowlist)", () => {
    expect(isAdminUser({ id: "u", email: "user@example.com" })).toBe(false);
  });
});
