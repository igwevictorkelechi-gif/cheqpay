import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { verifySupabaseJwt } from "./auth";
import { AuthError } from "./http";

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
    expect(user).toEqual({
      id: "user-123",
      email: "a@b.com",
      phone: "+2348012345678",
      role: "authenticated",
    });
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
});
