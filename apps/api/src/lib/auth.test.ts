import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { isAdminUser, requireMfa, verifySupabaseJwt } from "./auth";
import { AuthError, ForbiddenError } from "./http";

const SECRET = "test-supabase-jwt-secret-0123456789";
const key = new TextEncoder().encode(SECRET);

async function makeToken(
  claims: Record<string, unknown>,
  opts: { expiresIn?: string; secret?: Uint8Array } = {}
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "1h")
    .sign(opts.secret ?? key);
}

describe("verifySupabaseJwt", () => {
  it("accepts a valid token and returns claims", async () => {
    const token = await makeToken({
      sub: "user-123",
      email: "a@b.com",
      phone: "+2348012345678",
      role: "authenticated",
    });
    const user = await verifySupabaseJwt(token, SECRET);
    expect(user).toMatchObject({
      id: "user-123",
      email: "a@b.com",
      phone: "+2348012345678",
      role: "authenticated",
    });
    expect(user.isAdmin).toBe(false);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await makeToken(
      { sub: "user-123" },
      { secret: new TextEncoder().encode("a-totally-different-secret-value") }
    );
    await expect(verifySupabaseJwt(token, SECRET)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key);
    await expect(verifySupabaseJwt(token, SECRET)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token with no subject", async () => {
    const token = await makeToken({ email: "a@b.com" });
    await expect(verifySupabaseJwt(token, SECRET)).rejects.toBeInstanceOf(AuthError);
  });

  it("throws when no secret is configured", async () => {
    const token = await makeToken({ sub: "x" });
    await expect(verifySupabaseJwt(token, "")).rejects.toBeInstanceOf(AuthError);
  });

  it("captures the aal (MFA) claim", async () => {
    const token = await makeToken({ sub: "u", email: "a@b.com", aal: "aal2" });
    const user = await verifySupabaseJwt(token, SECRET);
    expect(user.aal).toBe("aal2");
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

describe("verifySupabaseJwt admin role", () => {
  it("derives isAdmin from app_metadata.role", async () => {
    const token = await makeToken({ sub: "u", app_metadata: { role: "admin" } });
    const user = await verifySupabaseJwt(token, SECRET);
    expect(user.isAdmin).toBe(true);
  });
});
