import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the two places sub admins live: the admin_accounts
// table and the Roles list in platform_settings.
type Account = {
  email: string;
  password_hash: string;
  must_change: boolean;
  created_at: Date;
  password_changed_at: Date | null;
  sections: string[];
  otp_pending: string | null;
  otp_secret: string | null;
  otp_last_counter: number | null;
};
const h = vi.hoisted(() => ({
  accounts: new Map<string, Account>(),
  settings: new Map<string, string>(),
}));

function sql(strings: TemplateStringsArray): string {
  return strings.join("?").replace(/\s+/g, " ").trim();
}

const view = (a: Account) => ({ ...a, otp_enrolled: a.otp_secret !== null });

vi.mock("@cheqpay/db", () => ({
  prisma: {
    $executeRawUnsafe: async () => 0,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = sql(strings);
      if (q.includes("WHERE email = ANY")) {
        const list = values[0] as string[];
        return [...h.accounts.values()].filter((a) => list.includes(a.email)).map(view);
      }
      const row = h.accounts.get(values[0] as string);
      if (!row) return [];
      if (q.startsWith("SELECT otp_pending")) return row.otp_secret === null ? [{ otp_pending: row.otp_pending }] : [];
      if (q.startsWith("SELECT otp_secret")) return [{ otp_secret: row.otp_secret }];
      return [view(row)];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = sql(strings);
      if (q.startsWith("INSERT INTO admin_accounts")) {
        const [email, hash] = values as string[];
        const prev = h.accounts.get(email);
        h.accounts.set(email, {
          email,
          password_hash: hash,
          must_change: true,
          created_at: new Date(),
          password_changed_at: null,
          sections: prev?.sections ?? [],
          otp_pending: prev?.otp_pending ?? null,
          otp_secret: prev?.otp_secret ?? null,
          otp_last_counter: prev?.otp_last_counter ?? null,
        });
        return 1;
      }
      if (q.startsWith("UPDATE admin_accounts SET password_hash")) {
        const [hash, email] = values as string[];
        Object.assign(h.accounts.get(email)!, { password_hash: hash, must_change: false, password_changed_at: new Date() });
        return 1;
      }
      if (q.startsWith("UPDATE admin_accounts SET sections")) {
        const [sections, email] = values as [string[], string];
        const row = h.accounts.get(email);
        if (!row) return 0;
        row.sections = sections;
        return 1;
      }
      if (q.startsWith("UPDATE admin_accounts SET otp_pending")) {
        const [secret, email] = values as string[];
        const row = h.accounts.get(email);
        if (!row || row.otp_secret !== null) return 0;
        row.otp_pending = secret;
        return 1;
      }
      if (q.startsWith("UPDATE admin_accounts SET otp_secret = otp_pending")) {
        const [counter, email, pending] = values as [number, string, string];
        const row = h.accounts.get(email);
        if (!row || row.otp_secret !== null || row.otp_pending !== pending) return 0;
        Object.assign(row, { otp_secret: pending, otp_pending: null, otp_last_counter: counter });
        return 1;
      }
      if (q.startsWith("UPDATE admin_accounts SET otp_last_counter")) {
        const [counter, email, secret] = values as [number, string, string];
        const row = h.accounts.get(email);
        if (!row || row.otp_secret !== secret) return 0;
        if (row.otp_last_counter !== null && row.otp_last_counter >= counter) return 0;
        row.otp_last_counter = counter;
        return 1;
      }
      if (q.startsWith("UPDATE admin_accounts SET otp_secret = NULL")) {
        const row = h.accounts.get(values[0] as string);
        if (row) Object.assign(row, { otp_secret: null, otp_pending: null, otp_last_counter: null });
        return 1;
      }
      if (q.startsWith("DELETE FROM admin_accounts")) {
        h.accounts.delete(values[0] as string);
        return 1;
      }
      throw new Error(`unexpected SQL in test: ${q}`);
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

import { createHmac } from "node:crypto";
import {
  activateSubAdminOtp,
  beginSubAdminOtpSetup,
  changeOwnSubAdminPassword,
  consumeSubAdminOtp,
  deleteSubAdmin,
  getSubAdminState,
  isStrongAdminPassword,
  listSubAdmins,
  resetSubAdminOtp,
  setSubAdminPassword,
  setSubAdminSections,
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
      sections: [],
      otpEnrolled: false,
    });
    await expect(verifySubAdminLogin("sub@mycheqpay.com", "wrong-password-1")).resolves.toBeNull();
    expect((await listSubAdmins())[0].status).toBe("pending");
  });

  it("changing the password clears the forced change and retires the starting one", async () => {
    await setSubAdminPassword("sub@mycheqpay.com", START, "owner@x.com");
    await expect(changeOwnSubAdminPassword("sub@mycheqpay.com", "nope", OWN)).resolves.toBe(false);
    await expect(changeOwnSubAdminPassword("sub@mycheqpay.com", START, OWN)).resolves.toBe(true);
    await expect(verifySubAdminLogin("sub@mycheqpay.com", START)).resolves.toBeNull();
    await expect(verifySubAdminLogin("sub@mycheqpay.com", OWN)).resolves.toMatchObject({
      email: "sub@mycheqpay.com",
      mustChange: false,
    });
    await expect(getSubAdminState("sub@mycheqpay.com")).resolves.toEqual({
      active: true,
      mustChange: false,
      sections: [],
      otpEnrolled: false,
    });
    expect((await listSubAdmins())[0].status).toBe("active");
  });

  it("a reset forces a change again", async () => {
    await setSubAdminPassword("sub@mycheqpay.com", START, "owner@x.com");
    await changeOwnSubAdminPassword("sub@mycheqpay.com", START, OWN);
    await setSubAdminPassword("sub@mycheqpay.com", "Another-start-99", "owner@x.com");
    await expect(getSubAdminState("sub@mycheqpay.com")).resolves.toMatchObject({ active: true, mustChange: true });
    expect(JSON.parse(h.settings.get("admin_emails")!)).toHaveLength(1);
  });

  it("removing a sub admin, or taking them off the Roles list, locks them out", async () => {
    await setSubAdminPassword("a@x.com", START, "owner@x.com");
    await setSubAdminPassword("b@x.com", START, "owner@x.com");
    await deleteSubAdmin("a@x.com", "owner@x.com");
    await expect(verifySubAdminLogin("a@x.com", START)).resolves.toBeNull();
    await expect(getSubAdminState("a@x.com")).resolves.toEqual({
      active: false,
      mustChange: false,
      sections: [],
      otpEnrolled: false,
    });

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
    // Who-am-I stays open so the dashboard can tell them what's left to do.
    expect(subAdminMayCall("GET", "/api/admin/me", true)).toBe(true);
    expect(subAdminMayCall("POST", "/api/admin/me/otp", true)).toBe(false);
  });

  it("opens every path of a granted section, any method, and nothing next to it", () => {
    const giftcards = ["giftcards"] as const;
    expect(subAdminMayCall("GET", "/api/admin/giftcards/trades", false, giftcards)).toBe(true);
    expect(subAdminMayCall("POST", "/api/admin/giftcards/trades/abc", false, giftcards)).toBe(true);
    expect(subAdminMayCall("GET", "/api/admin/giftcards", false, giftcards)).toBe(true);
    expect(subAdminMayCall("GET", "/api/admin/giftcardsx", false, giftcards)).toBe(false);
    expect(subAdminMayCall("GET", "/api/admin/users", false, giftcards)).toBe(false);
    expect(subAdminMayCall("GET", "/api/admin/giftcards/trades", true, giftcards)).toBe(false);
  });

  it("never opens what stays with Super Admins, whatever is granted", () => {
    const everything = ["giftcards", "users", "kyc", "transactions", "withdrawals", "virtual_accounts", "gadgets", "referrals", "ads", "events", "developers", "bills", "content", "support", "compliance"] as const;
    for (const path of [
      "/api/admin/adjust-balance",
      "/api/admin/credit-crypto",
      "/api/admin/roles",
      "/api/admin/sub-admins",
      "/api/admin/otp",
      "/api/admin/credentials",
      "/api/admin/settings",
      "/api/admin/crypto-wallets",
      "/api/admin/blocked-ips",
      "/api/admin/sessions",
      "/api/admin/features",
    ]) {
      expect(subAdminMayCall("POST", path, false, everything), path).toBe(false);
    }
  });

  it("may set up their own authenticator and alerts", () => {
    expect(subAdminMayCall("POST", "/api/admin/me/otp", false)).toBe(true);
    expect(subAdminMayCall("POST", "/api/admin/push", false)).toBe(true);
  });
});

describe("sections", () => {
  it("keeps known sections only, in order, for an existing sub admin", async () => {
    await setSubAdminPassword("sub@x.com", START, "owner@x.com");
    await expect(setSubAdminSections("sub@x.com", ["users", "nope", "giftcards", "giftcards"] as never)).resolves.toBe(true);
    await expect(getSubAdminState("sub@x.com")).resolves.toMatchObject({ sections: ["giftcards", "users"] });
    expect((await listSubAdmins())[0].sections).toEqual(["giftcards", "users"]);
    await expect(setSubAdminSections("ghost@x.com", ["users"])).resolves.toBe(false);
  });

  it("survive a password reset", async () => {
    await setSubAdminPassword("sub@x.com", START, "owner@x.com");
    await setSubAdminSections("sub@x.com", ["giftcards"]);
    await setSubAdminPassword("sub@x.com", "Another-start-99", "owner@x.com");
    await expect(getSubAdminState("sub@x.com")).resolves.toMatchObject({ sections: ["giftcards"] });
  });
});

// RFC 6238 code for a base32 secret at a timestep, as an authenticator app shows it.
function codeFor(secretB32: string, step = Math.floor(Date.now() / 30_000)): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secretB32) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const hm = createHmac("sha1", Buffer.from(bytes)).update(msg).digest();
  const off = hm[hm.length - 1] & 0xf;
  const n = (((hm[off] & 0x7f) << 24) | (hm[off + 1] << 16) | (hm[off + 2] << 8) | hm[off + 3]) % 1_000_000;
  return String(n).padStart(6, "0");
}

describe("a sub admin's own authenticator", () => {
  beforeEach(async () => {
    await setSubAdminPassword("sub@x.com", START, "owner@x.com");
  });

  it("enrols with a code from the app, then each code works once", async () => {
    const started = await beginSubAdminOtpSetup("sub@x.com");
    expect(started?.otpauthUrl).toContain("otpauth://totp/");
    await expect(activateSubAdminOtp("sub@x.com", "000000")).resolves.toBe(false);
    await expect(activateSubAdminOtp("sub@x.com", codeFor(started!.secret))).resolves.toBe(true);
    await expect(getSubAdminState("sub@x.com")).resolves.toMatchObject({ otpEnrolled: true });

    // The enrolment code's timestep is spent; the next one works, once.
    const next = codeFor(started!.secret, Math.floor(Date.now() / 30_000) + 1);
    await expect(consumeSubAdminOtp("sub@x.com", next)).resolves.toBe(true);
    await expect(consumeSubAdminOtp("sub@x.com", next)).resolves.toBe(false);
  });

  it("can't be replaced by the sub admin once enrolled; a reset lets them enrol again", async () => {
    const first = await beginSubAdminOtpSetup("sub@x.com");
    await activateSubAdminOtp("sub@x.com", codeFor(first!.secret));
    await expect(beginSubAdminOtpSetup("sub@x.com")).resolves.toBeNull();

    await resetSubAdminOtp("sub@x.com");
    await expect(getSubAdminState("sub@x.com")).resolves.toMatchObject({ otpEnrolled: false });
    await expect(consumeSubAdminOtp("sub@x.com", codeFor(first!.secret))).resolves.toBe(false);
    await expect(beginSubAdminOtpSetup("sub@x.com")).resolves.not.toBeNull();
  });

  it("enrolment needs the sub admin to sign in with a code too", async () => {
    const started = await beginSubAdminOtpSetup("sub@x.com");
    await activateSubAdminOtp("sub@x.com", codeFor(started!.secret));
    await expect(verifySubAdminLogin("sub@x.com", START)).resolves.toMatchObject({ otpEnrolled: true });
  });
});
