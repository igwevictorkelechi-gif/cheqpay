import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the two places sub admins live: the admin_accounts
// table and the Roles list in platform_settings.
const h = vi.hoisted(() => ({
  accounts: new Map<string, { email: string; password_hash: string; must_change: boolean; created_at: Date; password_changed_at: Date | null }>(),
  settings: new Map<string, string>(),
}));

function sql(strings: TemplateStringsArray): string {
  return strings.join("?").replace(/\s+/g, " ").trim();
}

vi.mock("@cheqpay/db", () => ({
  prisma: {
    $executeRawUnsafe: async () => 0,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = sql(strings);
      if (q.includes("WHERE email = ANY")) {
        const list = values[0] as string[];
        return [...h.accounts.values()].filter((a) => list.includes(a.email));
      }
      const row = h.accounts.get(values[0] as string);
      return row ? [row] : [];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = sql(strings);
      if (q.startsWith("INSERT INTO admin_accounts")) {
        const [email, hash] = values as string[];
        h.accounts.set(email, { email, password_hash: hash, must_change: true, created_at: new Date(), password_changed_at: null });
      } else if (q.startsWith("UPDATE admin_accounts")) {
        const [hash, email] = values as string[];
        const row = h.accounts.get(email)!;
        Object.assign(row, { password_hash: hash, must_change: false, password_changed_at: new Date() });
      } else if (q.startsWith("DELETE FROM admin_accounts")) {
        h.accounts.delete(values[0] as string);
      }
      return 1;
    },
    platformSetting: {
      findUnique: async ({ where: { key } }: { where: { key: string } }) =>
        h.settings.has(key) ? { key, value: h.settings.get(key) } : null,
      upsert: async ({ where: { key }, update }: { where: { key: string }; update: { value: string } }) => {
        h.settings.set(key, update.value);
        return { key, value: update.value };
      },
    },
  },
}));

import {
  changeOwnSubAdminPassword,
  deleteSubAdmin,
  getSubAdminState,
  isStrongAdminPassword,
  listSubAdmins,
  setSubAdminPassword,
  verifySubAdminLogin,
} from "./adminCreds";
import { subAdminMayCall } from "./subAdminAccess";

const START = "Starting-pass-2026";
const OWN = "My-own-password-77";

beforeEach(() => {
  h.accounts.clear();
  h.settings.clear();
});

describe("sub admin accounts", () => {
  it("a new sub admin signs in with the starting password and must change it", async () => {
    await setSubAdminPassword("Sub@MyCheqPay.com", START, "owner@x.com");
    expect(JSON.parse(h.settings.get("admin_emails")!)).toEqual([{ email: "sub@mycheqpay.com", role: "admin" }]);
    await expect(verifySubAdminLogin("sub@mycheqpay.com", START)).resolves.toEqual({
      email: "sub@mycheqpay.com",
      mustChange: true,
    });
    await expect(verifySubAdminLogin("sub@mycheqpay.com", "wrong-password-1")).resolves.toBeNull();
    expect((await listSubAdmins())[0].status).toBe("pending");
  });

  it("changing the password clears the forced change and retires the starting one", async () => {
    await setSubAdminPassword("sub@mycheqpay.com", START, "owner@x.com");
    await expect(changeOwnSubAdminPassword("sub@mycheqpay.com", "nope", OWN)).resolves.toBe(false);
    await expect(changeOwnSubAdminPassword("sub@mycheqpay.com", START, OWN)).resolves.toBe(true);
    await expect(verifySubAdminLogin("sub@mycheqpay.com", START)).resolves.toBeNull();
    await expect(verifySubAdminLogin("sub@mycheqpay.com", OWN)).resolves.toEqual({
      email: "sub@mycheqpay.com",
      mustChange: false,
    });
    await expect(getSubAdminState("sub@mycheqpay.com")).resolves.toEqual({ active: true, mustChange: false });
    expect((await listSubAdmins())[0].status).toBe("active");
  });

  it("a reset forces a change again", async () => {
    await setSubAdminPassword("sub@mycheqpay.com", START, "owner@x.com");
    await changeOwnSubAdminPassword("sub@mycheqpay.com", START, OWN);
    await setSubAdminPassword("sub@mycheqpay.com", "Another-start-99", "owner@x.com");
    await expect(getSubAdminState("sub@mycheqpay.com")).resolves.toEqual({ active: true, mustChange: true });
    expect(JSON.parse(h.settings.get("admin_emails")!)).toHaveLength(1);
  });

  it("removing a sub admin, or taking them off the Roles list, locks them out", async () => {
    await setSubAdminPassword("a@x.com", START, "owner@x.com");
    await setSubAdminPassword("b@x.com", START, "owner@x.com");
    await deleteSubAdmin("a@x.com", "owner@x.com");
    await expect(verifySubAdminLogin("a@x.com", START)).resolves.toBeNull();
    await expect(getSubAdminState("a@x.com")).resolves.toEqual({ active: false, mustChange: false });

    // Roles page edit that drops b@x.com (password row still there).
    h.settings.set("admin_emails", JSON.stringify([]));
    await expect(verifySubAdminLogin("b@x.com", START)).resolves.toBeNull();
    await expect(getSubAdminState("b@x.com")).resolves.toMatchObject({ active: false });
  });

  it("a Super Admin on the Roles list is not a sub admin", async () => {
    await setSubAdminPassword("s@x.com", START, "owner@x.com");
    h.settings.set("admin_emails", JSON.stringify([{ email: "s@x.com", role: "super" }]));
    await expect(verifySubAdminLogin("s@x.com", START)).resolves.toBeNull();
  });

  it("password rule: 12+ characters with letters and numbers", () => {
    expect(isStrongAdminPassword("short1a")).toBe(false);
    expect(isStrongAdminPassword("allletterslong")).toBe(false);
    expect(isStrongAdminPassword("123456789012")).toBe(false);
    expect(isStrongAdminPassword(START)).toBe(true);
  });
});

describe("what a sub admin may call", () => {
  it("reads Dashboard and Analytics data only", () => {
    expect(subAdminMayCall("GET", "/api/admin/analytics", false)).toBe(true);
    expect(subAdminMayCall("GET", "/api/admin/transactions", false)).toBe(true);
    expect(subAdminMayCall("POST", "/api/admin/transactions", false)).toBe(false);
    expect(subAdminMayCall("GET", "/api/admin/users", false)).toBe(false);
    expect(subAdminMayCall("GET", "/api/admin/withdrawals", false)).toBe(false);
    expect(subAdminMayCall("PATCH", "/api/admin/credentials", false)).toBe(false);
    expect(subAdminMayCall("PATCH", "/api/admin/me/password", false)).toBe(true);
  });

  it("can only change their password until they've replaced the starting one", () => {
    expect(subAdminMayCall("GET", "/api/admin/analytics", true)).toBe(false);
    expect(subAdminMayCall("PATCH", "/api/admin/me/password", true)).toBe(true);
  });
});
