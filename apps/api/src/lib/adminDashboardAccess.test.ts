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
    expect(subAdminAccess("/account/authenticator", "GET", true)).toBe("change_password");
  });

  it("opens the sections a Super Admin granted, pages and proxies, and nothing beside them", () => {
    const giftcards = ["giftcards"];
    expect(subAdminAccess("/gift-cards", "GET", false, giftcards)).toBe("allow");
    expect(subAdminAccess("/gift-cards/rates", "GET", false, giftcards)).toBe("allow");
    expect(subAdminAccess("/api/giftcards/trades/abc", "POST", false, giftcards)).toBe("allow");
    expect(subAdminAccess("/users", "GET", false, giftcards)).toBe("denied");
    expect(subAdminAccess("/api/users", "GET", false, giftcards)).toBe("denied");

    // Popup/banners/broadcast is grantable; Feature Toggles next to it is not.
    expect(subAdminAccess("/features/popup", "GET", false, ["content"])).toBe("allow");
    expect(subAdminAccess("/features", "GET", false, ["content"])).toBe("denied");
    expect(subAdminAccess("/api/features", "POST", false, ["content"])).toBe("denied");

    // Still nothing until the starting password is replaced.
    expect(subAdminAccess("/gift-cards", "GET", true, giftcards)).toBe("change_password");
  });

  it("never opens what stays with Super Admins, whatever is granted", () => {
    const all = ["giftcards", "users", "kyc", "transactions", "withdrawals", "virtual_accounts", "gadgets", "referrals", "ads", "events", "developers", "bills", "content", "support", "compliance"];
    for (const p of ["/roles", "/profile", "/adjust-balance", "/security/login-activity", "/provider-settings", "/payment-settings", "/trading-settings", "/crypto-wallets", "/features"]) {
      expect(subAdminAccess(p, "GET", false, all), p).toBe("denied");
    }
    for (const p of ["/api/roles", "/api/sub-admins", "/api/profile", "/api/adjust-balance", "/api/credit-crypto", "/api/admin-otp", "/api/platform-settings", "/api/blocked-ips", "/api/sessions"]) {
      expect(subAdminAccess(p, "POST", false, all), p).toBe("denied");
    }
  });

  it("lets them set up their own authenticator and alerts", () => {
    expect(subAdminAccess("/account/authenticator", "GET", false)).toBe("allow");
    expect(subAdminAccess("/api/account/otp", "POST", false)).toBe("allow");
    expect(subAdminAccess("/api/push", "POST", false)).toBe("allow");
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

  it("carries a sub admin's sections under the signature", async () => {
    const c = await sessionCookieValue("sub@x.com", "admin", "ep", undefined, false, ["users", "giftcards", "bogus"]);
    await expect(sessionInfo(c)).resolves.toMatchObject({ role: "admin", sections: ["giftcards", "users"] });

    // Granting yourself a section by hand breaks the signature.
    const parts = c.split(".");
    parts[5] = Buffer.from("giftcards,users,withdrawals").toString("base64url");
    await expect(sessionInfo(parts.join("."))).resolves.toBeNull();

    // A Super Admin's cookie carries none: they have everything anyway.
    const owner = await sessionCookieValue("o@x.com", "super", "ep", undefined, false, ["giftcards"]);
    await expect(sessionInfo(owner)).resolves.toMatchObject({ role: "super", sections: [] });
  });

  it("still reads v3 sessions, with no sections", async () => {
    const { createHmac } = await import("node:crypto");
    const iat = Math.floor(Date.now() / 1000);
    const b = (s: string) => Buffer.from(s).toString("base64url");
    const sig = createHmac("sha256", "d".repeat(32)).update(`session:v3:s@x.com:admin:${iat}:ep:-`).digest("hex");
    const v3 = `${b("s@x.com")}.${b("admin")}.${iat}.${b("ep")}.-.${sig}`;
    await expect(sessionInfo(v3)).resolves.toMatchObject({ role: "admin", mustChangePassword: false, sections: [] });
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
