import { afterEach, describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { DEFAULT_SCOPES, KEY_PATTERN, SENSITIVE_SCOPES, fromPublicId, toPublicId } from "@cheqpay/devapi";
import { ApiError } from "../http";
import { generateKeySecret, hashKey, liveKeyProblem, parseAllowedIps, parseBearer, parseScopes } from "./keys";
import { ipAllowed, isPublicAddress, normalizeIp, parseAllowEntry, trustedClientIp } from "./net";
import { luhnValid, redactForLog, scrubSensitive } from "./redact";
import { canonicalJson, requestHash } from "./idempotency";
import { keyRefusal, toV1Error, V1Error } from "./handler";
import type { AccountRow, KeyRow } from "./types";

describe("public ids", () => {
  const uuid = "3f0c9a8e-5b7d-4e21-a6f1-c2b3d4e5f607";
  it("round-trips", () => {
    const id = toPublicId("wallet", uuid);
    expect(id).toBe("wal_3f0c9a8e5b7d4e21a6f1c2b3d4e5f607");
    expect(fromPublicId("wallet", id)).toBe(uuid);
  });
  it("refuses an id of another kind, a bad length or upper case", () => {
    const id = toPublicId("wallet", uuid);
    expect(fromPublicId("transaction", id)).toBeNull();
    expect(fromPublicId("wallet", id.slice(0, -1))).toBeNull();
    expect(fromPublicId("wallet", id.toUpperCase())).toBeNull();
    expect(fromPublicId("wallet", `${id}' OR 1=1`)).toBeNull();
    expect(fromPublicId("wallet", 42)).toBeNull();
  });
});

describe("API keys", () => {
  it("are 256-bit, prefixed by mode and never repeat", () => {
    const a = generateKeySecret("test");
    const b = generateKeySecret("live");
    expect(a).toMatch(KEY_PATTERN);
    expect(b).toMatch(KEY_PATTERN);
    expect(a.startsWith("cp_test_sk_")).toBe(true);
    expect(b.startsWith("cp_live_sk_")).toBe(true);
    expect(new Set(Array.from({ length: 200 }, () => generateKeySecret("test"))).size).toBe(200);
  });

  it("are stored as a sha256 only", () => {
    const k = generateKeySecret("test");
    expect(hashKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey(k)).toBe(hashKey(k));
    expect(hashKey(k)).not.toContain(k.slice(11, 20));
  });

  it("are read only from a well-formed Bearer header", () => {
    const k = generateKeySecret("live");
    expect(parseBearer(`Bearer ${k}`)).toEqual({ secret: k, mode: "live" });
    expect(parseBearer(`bearer ${k}`)?.mode).toBe("live");
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer(k)).toBeNull();
    expect(parseBearer(`Basic ${k}`)).toBeNull();
    expect(parseBearer(`Bearer ${k} extra`)).toBeNull();
    expect(parseBearer(`Bearer ${k.slice(0, -1)}`)).toBeNull();
    expect(parseBearer("Bearer cp_prod_sk_" + "a".repeat(43))).toBeNull();
  });

  it("get every scope but the sensitive ones by default", () => {
    expect(parseScopes(undefined)).toEqual([...DEFAULT_SCOPES]);
    expect(DEFAULT_SCOPES).not.toContain("cards:details");
    expect(SENSITIVE_SCOPES).toContain("cards:details");
  });

  it("refuse unknown or empty scopes instead of dropping them", () => {
    expect(() => parseScopes(["wallets:read", "wallets:write_everything"])).toThrow(ApiError);
    expect(() => parseScopes([])).toThrow(ApiError);
    expect(parseScopes(["wallets:read", "wallets:read"])).toEqual(["wallets:read"]);
  });

  it("take IP allowlists of addresses and narrow ranges only", () => {
    expect(parseAllowedIps(["203.0.113.7", "198.51.100.0/24", "2001:db8::/48", " ::ffff:192.0.2.1 "])).toEqual([
      "203.0.113.7",
      "198.51.100.0/24",
      "2001:db8::/48",
      "192.0.2.1",
    ]);
    for (const bad of ["0.0.0.0/0", "10.0.0.0/8", "::/0", "2001::/16", "not-an-ip", "1.2.3.4/33", "1.2.3.4/24/1", 7]) {
      expect(() => parseAllowedIps([bad])).toThrow(ApiError);
    }
    expect(() => parseAllowedIps(Array.from({ length: 21 }, (_, i) => `203.0.113.${i}`))).toThrow(ApiError);
  });

  it("refuse IPv6 entries that would match IPv4 clients through the mapped block", () => {
    // Node checks an IPv4 client against IPv6 rules as ::ffff:a.b.c.d, so each
    // of these would have quietly matched every (or a whole range of) IPv4 address.
    for (const bad of ["::/32", "::/80", "::ffff:0:0/96", "0:0:0:0:0:ffff::/80", "::ffff:808:0/112", "::ffff:808:808"]) {
      expect(() => parseAllowedIps([bad]), bad).toThrow(ApiError);
    }
    expect(parseAllowedIps(["2001:db8::/32", "2606:4700::1111", "0:0:1::/48"])).toEqual(["2001:db8::/32", "2606:4700::1111", "0:0:1::/48"]);
    // An accepted IPv6 range never matches an IPv4 client.
    const v6 = parseAllowedIps(["2001:db8::/32", "0:0:1::/48"]);
    for (const ip of ["8.8.8.8", "0.0.0.1", "203.0.113.9"]) expect(ipAllowed(ip, v6), ip).toBe(false);
  });

  it("need an allowlist when live and able to reveal card details, or when the account requires one", () => {
    expect(liveKeyProblem({ require_ip_allowlist: false }, ["cards:details"], [])).toMatch(/allowlist/);
    expect(liveKeyProblem({ require_ip_allowlist: false }, ["cards:details"], ["203.0.113.7"])).toBeNull();
    expect(liveKeyProblem({ require_ip_allowlist: true }, ["wallets:read"], [])).toMatch(/allowlist/);
    expect(liveKeyProblem({ require_ip_allowlist: false }, ["wallets:read"], [])).toBeNull();
  });
});

describe("IP handling", () => {
  it("normalises", () => {
    expect(normalizeIp("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });

  it("matches allowlists exactly and by range", () => {
    const list = ["203.0.113.7", "198.51.100.0/24", "2001:db8:abcd::/48"].map((e) => parseAllowEntry(e)!);
    expect(ipAllowed("203.0.113.7", list)).toBe(true);
    expect(ipAllowed("203.0.113.8", list)).toBe(false);
    expect(ipAllowed("198.51.100.200", list)).toBe(true);
    expect(ipAllowed("::ffff:198.51.100.200", list)).toBe(true);
    expect(ipAllowed("2001:db8:abcd:1::5", list)).toBe(true);
    expect(ipAllowed("2001:db8:abce::5", list)).toBe(false);
    expect(ipAllowed(null, list)).toBe(false);
  });

  it("treats only the public internet as public", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::a9fe:a9fe",
      "2002:a9fe:a9fe::1",
      "2001:db8::1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "102.89.0.1", "2606:4700:4700::1111", "2a00:1450:4001::200e"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
    expect(isPublicAddress("localhost")).toBe(false);
  });

  describe("the caller's address", () => {
    const saved = process.env.VERCEL;
    afterEach(() => {
      if (saved === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = saved;
    });
    it("on Vercel, comes only from headers the platform sets", () => {
      process.env.VERCEL = "1";
      const req = new Request("https://x/v1", { headers: { "x-forwarded-for": "6.6.6.6", "x-vercel-forwarded-for": "102.89.0.1" } });
      expect(trustedClientIp(req)).toBe("102.89.0.1");
      const spoof = new Request("https://x/v1", { headers: { "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "6.6.6.6" } });
      expect(trustedClientIp(spoof)).toBeNull();
    });
  });
});

describe("log redaction", () => {
  it("keeps only allowlisted fields, never nested objects", () => {
    const out = redactForLog(
      { amount: 5000, currency: "NGN", bvn: "22222222222", identity: { number: "A1234" }, reference: "ord-1", note: "hi" },
      ["amount", "currency", "reference", "identity"],
    );
    expect(out).toEqual({ amount: 5000, currency: "NGN", reference: "ord-1", identity: "[omitted]" });
    expect(JSON.stringify(out)).not.toContain("22222222222");
    expect(redactForLog("not an object", ["a"])).toBeNull();
    expect(redactForLog([1, 2], ["0"])).toBeNull();
  });

  it("masks secrets, BVNs and card numbers inside kept strings", () => {
    const key = generateKeySecret("live");
    const s = scrubSensitive(
      `key ${key} secret whsec_abcdefghijklmnop bvn 22345678901 card 4242 4242 4242 4242 and 5399-8300-0000-0008 order 1234567890123`,
    );
    expect(s).not.toContain(key);
    expect(s).not.toContain("whsec_abcdefghijklmnop");
    expect(s).not.toContain("22345678901");
    expect(s).not.toContain("4242 4242 4242 4242");
    expect(s).toContain("[card •••• 4242]");
    expect(s).toContain("1234567890123"); // 13 digits, not Luhn-valid: an order number, kept
  });

  it("checks Luhn", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("")).toBe(false);
  });
});

describe("idempotency hashing", () => {
  it("ignores key order but not values or the route", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
    expect(requestHash("/v1/transfers", { a: 1, b: 2 })).toBe(requestHash("/v1/transfers", { b: 2, a: 1 }));
    expect(requestHash("/v1/transfers", { a: 1 })).not.toBe(requestHash("/v1/transfers", { a: 2 }));
    expect(requestHash("/v1/transfers", { a: 1 })).not.toBe(requestHash("/v1/bills/payments", { a: 1 }));
  });
});

describe("the request gate", () => {
  const key = (over: Partial<KeyRow> = {}): KeyRow => ({
    id: "k",
    account_id: "a",
    mode: "live",
    label: "server",
    key_hash: "h",
    last4: "abcd",
    scopes: ["wallets:read"],
    allowed_ips: [],
    expires_at: null,
    revoked_at: null,
    revoked_reason: null,
    last_used_at: null,
    last_used_ip: null,
    created_at: new Date(),
    ...over,
  });
  const account = (over: Partial<AccountRow> = {}) => ({ status: "approved", require_ip_allowlist: false, ...over }) as AccountRow;

  it("names why a key was refused (for the owner's log only)", () => {
    expect(keyRefusal(key(), account(), "203.0.113.7")).toBeNull();
    expect(keyRefusal(key({ revoked_at: new Date() }), account(), null)).toBe("revoked");
    expect(keyRefusal(key({ expires_at: new Date(Date.now() - 1000) }), account(), null)).toBe("expired");
    expect(keyRefusal(key(), account({ status: "suspended" }), null)).toBe("account_suspended");
    expect(keyRefusal(key({ allowed_ips: ["203.0.113.7"] }), account(), "198.51.100.1")).toBe("ip_not_allowed");
    expect(keyRefusal(key({ allowed_ips: ["203.0.113.7"] }), account(), "203.0.113.7")).toBeNull();
    expect(keyRefusal(key(), account({ require_ip_allowlist: true }), "203.0.113.7")).toBe("ip_allowlist_required");
    expect(keyRefusal(key({ scopes: ["cards:details"] }), account(), "203.0.113.7")).toBe("ip_allowlist_required");
    expect(keyRefusal(key({ mode: "test", scopes: ["cards:details"] }), account(), null)).toBeNull();
  });

  it("maps errors to one documented shape and leaks nothing internal", () => {
    let zerr: ZodError | null = null;
    try {
      z.object({ amount: z.number() }).strict().parse({ amount: "x" });
    } catch (e) {
      zerr = e as ZodError;
    }
    const v = toV1Error(zerr, "req_1");
    expect(v.status).toBe(400);
    expect(v.body.error).toMatchObject({ type: "invalid_request_error", code: "validation_error", param: "amount", request_id: "req_1" });

    const a = toV1Error(new ApiError(422, "Maplerad says no", "insufficient_funds"), "req_2");
    expect(a.body.error.message).not.toMatch(/maplerad/i);
    expect(a.body.error.type).toBe("invalid_request_error");

    expect(toV1Error(new V1Error(401, "x", "invalid_api_key"), "r").body.error.type).toBe("authentication_error");
    expect(toV1Error(new V1Error(402, "x", "subscription_inactive"), "r").body.error.type).toBe("permission_error");
    expect(toV1Error(new V1Error(429, "x", "rate_limited", null, 7), "r").retryAfter).toBe(7);

    const boom = toV1Error(new Error("password=hunter2 at db.internal:5432"), "req_3");
    expect(boom.status).toBe(500);
    expect(JSON.stringify(boom.body)).not.toContain("hunter2");
    expect(boom.body.error.code).toBe("internal_error");
  });
});
