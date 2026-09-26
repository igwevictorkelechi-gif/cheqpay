// The admin dashboard's own rules (apps/admin/lib/adminAuth.ts), tested here
// because this package runs the test suite.
import { beforeAll, describe, expect, it } from "vitest";
import { sessionCookieValue, sessionInfo, subAdminAccess } from "../../../admin/lib/adminAuth";

beforeAll(() => {
  process.env.ADMIN_DASHBOARD_SECRET = "d".repeat(32);
});

describe("dashboard access for sub admins", () => {
  it("opens Dashboard and Analytics, and nothing else", () => {
    for (const p of ["/", "/dashboard", "/analytics", "/account/password"]) {
      expect(subAdminAccess(p, "GET", false), p).toBe("allow");
    }
    for (const p of ["/users", "/kyc", "/withdrawals", "/transactions", "/roles", "/profile", "/features/popup"]) {
      expect(subAdminAccess(p, "GET", false), p).toBe("denied");
    }
    expect(subAdminAccess("/api/analytics", "GET", false)).toBe("allow");
    expect(subAdminAccess("/api/transactions", "GET", false)).toBe("allow");
    expect(subAdminAccess("/api/transactions", "POST", false)).toBe("denied");
    expect(subAdminAccess("/api/users", "GET", false)).toBe("denied");
    expect(subAdminAccess("/api/withdrawals", "GET", false)).toBe("denied");
    expect(subAdminAccess("/api/profile", "PATCH", false)).toBe("denied");
    expect(subAdminAccess("/api/sub-admins", "POST", false)).toBe("denied");
  });

  it("sends a sub admin on a starting password to set their own first", () => {
    expect(subAdminAccess("/dashboard", "GET", true)).toBe("change_password");
    expect(subAdminAccess("/api/analytics", "GET", true)).toBe("change_password");
    expect(subAdminAccess("/account/password", "GET", true)).toBe("allow");
    expect(subAdminAccess("/api/account/password", "PATCH", true)).toBe("allow");
    expect(subAdminAccess("/api/auth", "GET", true)).toBe("allow");
  });
});

describe("dashboard session cookie", () => {
  it("carries the must-change flag under the signature", async () => {
    const c = await sessionCookieValue("sub@x.com", "admin", "ep", undefined, true);
    await expect(sessionInfo(c)).resolves.toMatchObject({ email: "sub@x.com", role: "admin", mustChangePassword: true });

    // Clearing the flag by hand breaks the signature.
    const parts = c.split(".");
    parts[4] = "-";
    await expect(sessionInfo(parts.join("."))).resolves.toBeNull();

    // Promoting the role by hand does too.
    const promoted = c.split(".");
    promoted[1] = Buffer.from("super").toString("base64url");
    await expect(sessionInfo(promoted.join("."))).resolves.toBeNull();
  });

  it("still reads sessions issued before the flag existed", async () => {
    const { createHmac } = await import("node:crypto");
    const iat = Math.floor(Date.now() / 1000);
    const b = (s: string) => Buffer.from(s).toString("base64url");
    const sig = createHmac("sha256", "d".repeat(32)).update(`session:v2:o@x.com:super:${iat}:ep`).digest("hex");
    const v2 = `${b("o@x.com")}.${b("super")}.${iat}.${b("ep")}.${sig}`;
    await expect(sessionInfo(v2)).resolves.toMatchObject({ role: "super", mustChangePassword: false });
  });
});
