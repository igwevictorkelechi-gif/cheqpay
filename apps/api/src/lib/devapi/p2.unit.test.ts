// Unit tests for phase 2 of the developer API: the webhook SSRF guard, webhook
// signatures, deposit fees and the request schemas. No database needed.

import { describe, expect, it } from "vitest";
import { makeSafeLookup, safePostJson, webhookUrlProblem } from "./safeHttp";
import { endpointCreateSchema, signWebhook, verifyWebhookSignature } from "./webhooks";
import { depositFee } from "./deposits";
import { customerCreateSchema, customerUpdateSchema } from "./customers";
import { metadataSchema, referenceSchema, amountSchema, uniqueViolation } from "./inputs";
import { quoteSchema } from "./fx";
import type { LookupAddress } from "node:dns";

describe("webhook URLs", () => {
  it.each([
    "https://api.acme.ng/webhooks/cheqpay",
    "https://hooks.acme.com:443/x?y=1",
    "https://xn--bcher-kva.de/hook", // an internationalised name, as the URL parser hands it to us
  ])("accepts %s", (url) => {
    expect(webhookUrlProblem(url)).toBeNull();
  });

  it.each([
    ["http://api.acme.ng/hook", "https"],
    ["https://127.0.0.1/hook", "IP"],
    ["https://2130706433/hook", "IP"], // decimal 127.0.0.1
    ["https://0x7f.0.0.1/hook", "IP"], // hex
    ["https://0177.0.0.1/hook", "IP"], // octal
    ["https://127.1/hook", "IP"], // short form
    ["https://169.254.169.254/latest/meta-data", "IP"], // cloud metadata
    ["https://[::1]/hook", "IP"],
    ["https://[::ffff:127.0.0.1]/hook", "IP"],
    ["https://[fd00::1]/hook", "IP"],
    ["https://user:pass@api.acme.ng/hook", "username"],
    ["https://api.acme.ng:8443/hook", "port"],
    ["https://localhost/hook", "full domain|public"],
    ["https://localhost./hook", "full domain|public"],
    ["https://evil.localhost/hook", "public"],
    ["https://db.internal/hook", "public"],
    ["https://printer.local/hook", "public"],
    ["https://router.home.arpa/hook", "public"],
    ["https://metadata/hook", "full domain"],
    ["ftp://api.acme.ng/hook", "https"],
    ["not a url", "valid"],
    [`https://a.com/${"x".repeat(2100)}`, "long"],
  ])("refuses %s", (url, why) => {
    expect(webhookUrlProblem(url)).toMatch(new RegExp(why, "i"));
  });
});

describe("the connect-time address check", () => {
  type Answer = { err?: Error; addresses?: LookupAddress[] };
  const resolver = (answer: Answer) => (_h: string, _o: unknown, cb: (e: NodeJS.ErrnoException | null, a: LookupAddress[]) => void) =>
    cb((answer.err as NodeJS.ErrnoException) ?? null, answer.addresses ?? []);
  const run = (answer: Answer, all = false) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) =>
      makeSafeLookup(resolver(answer))("hooks.acme.ng", { all }, (err, address, family) => resolve({ err, address, family })),
    );
  const v4 = (address: string): LookupAddress => ({ address, family: 4 });
  const v6 = (address: string): LookupAddress => ({ address, family: 6 });

  it("lets a public address through, in both lookup styles", async () => {
    expect(await run({ addresses: [v4("93.184.216.34")] })).toMatchObject({ err: null, address: "93.184.216.34", family: 4 });
    expect((await run({ addresses: [v4("93.184.216.34"), v6("2606:2800:220:1::1")] }, true)).address).toHaveLength(2);
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["private 10/8", "10.0.0.5"],
    ["private 172.16/12", "172.20.1.1"],
    ["private 192.168/16", "192.168.1.1"],
    ["link-local / metadata", "169.254.169.254"],
    ["CGNAT", "100.64.0.1"],
    ["unspecified", "0.0.0.0"],
  ])("refuses %s (%s)", async (_name, ip) => {
    const r = await run({ addresses: [v4(ip)] });
    expect(r.err?.code).toBe("EADDRNOTPUBLIC");
  });

  it.each([["::1"], ["fd12:3456::1"], ["fe80::1"], ["::ffff:10.0.0.1"], ["::ffff:169.254.169.254"]])("refuses IPv6 %s", async (ip) => {
    expect((await run({ addresses: [v6(ip)] })).err?.code).toBe("EADDRNOTPUBLIC");
  });

  it("refuses a name that answers with one public and one private address (DNS rebinding)", async () => {
    expect((await run({ addresses: [v4("93.184.216.34"), v4("10.0.0.1")] }, true)).err?.code).toBe("EADDRNOTPUBLIC");
  });

  it("refuses an empty answer and passes resolver errors on", async () => {
    expect((await run({ addresses: [] })).err?.code).toBe("EADDRNOTPUBLIC");
    expect((await run({ err: Object.assign(new Error("nope"), { code: "ENOTFOUND" }) })).err?.code).toBe("ENOTFOUND");
  });

  it("is what a real delivery connects through: a name resolving to loopback is never reached", async () => {
    const lookup = makeSafeLookup(resolver({ addresses: [v4("127.0.0.1")] }));
    await expect(safePostJson("https://rebind.attacker.io/hook", "{}", {}, { lookup })).rejects.toMatchObject({ code: "EADDRNOTPUBLIC" });
  });

  it("refuses a bad URL before any connection", async () => {
    await expect(safePostJson("https://169.254.169.254/latest", "{}", {})).rejects.toThrow(/IP address/);
  });
});

describe("webhook signatures (Standard Webhooks)", () => {
  // The published Standard Webhooks test vector: any conforming library verifies our deliveries.
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
  const ts = 1614265330;
  const body = '{"test": 2432232314}';

  it("matches the specification's test vector", () => {
    expect(signWebhook(secret, id, ts, body)).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("verifies a genuine delivery and refuses tampering, staleness and the wrong secret", () => {
    const signature = signWebhook(secret, id, ts, body);
    const h = { id, timestamp: String(ts), signature };
    expect(verifyWebhookSignature(secret, h, body, ts + 10)).toBe(true);
    expect(verifyWebhookSignature(secret, h, body.replace("2432", "9999"), ts)).toBe(false);
    expect(verifyWebhookSignature(secret, { ...h, id: "msg_other" }, body, ts)).toBe(false);
    expect(verifyWebhookSignature(secret, h, body, ts + 301)).toBe(false);
    expect(verifyWebhookSignature(secret, h, body, ts - 301)).toBe(false);
    expect(verifyWebhookSignature("whsec_" + Buffer.alloc(24, 1).toString("base64"), h, body, ts)).toBe(false);
  });

  it("accepts any one valid signature, so a rolled secret keeps working during the overlap", () => {
    const old = "whsec_" + Buffer.alloc(32, 9).toString("base64");
    const both = `${signWebhook(old, id, ts, body)} ${signWebhook(secret, id, ts, body)}`;
    expect(verifyWebhookSignature(secret, { id, timestamp: String(ts), signature: both }, body, ts)).toBe(true);
    expect(verifyWebhookSignature(old, { id, timestamp: String(ts), signature: both }, body, ts)).toBe(true);
    const wrongVersion = signWebhook(secret, id, ts, body).replace("v1,", "v2,");
    expect(verifyWebhookSignature(secret, { id, timestamp: String(ts), signature: wrongVersion }, body, ts)).toBe(false);
  });
});

describe("deposit fees", () => {
  const plan = { depositFeeBps: 100, depositFeeCapMinor: 30_000 };
  it("is the plan's percentage, capped, and never more than the deposit", () => {
    expect(depositFee(plan, 1_000_000n)).toBe(10_000n); // 1% of ₦10,000 = ₦100
    expect(depositFee(plan, 100_000_000n)).toBe(30_000n); // capped at ₦300
    expect(depositFee(plan, 50n)).toBe(0n);
    expect(depositFee({ depositFeeBps: 0, depositFeeCapMinor: 0 }, 1_000_000n)).toBe(0n);
    expect(depositFee({ depositFeeBps: 20_000, depositFeeCapMinor: 0 }, 1_000n)).toBe(1_000n);
  });
});

describe("request schemas", () => {
  const customer = {
    first_name: "Ada",
    last_name: "Obi",
    email: "Ada@Example.ng",
    phone: "08031234567",
    date_of_birth: "1990-04-12",
    bvn: "12345678901",
    address: { street: "12 Marina Road", city: "Lagos", state: "Lagos", postal_code: "101001" },
    identity: { type: "NIN", number: "12345678901", document_front: "file_0123456789abcdef0123456789abcdef" },
    kyc_consent: true,
  };

  it("accepts a complete customer and normalises the email", () => {
    expect(customerCreateSchema.parse(customer).email).toBe("ada@example.ng");
  });

  it.each([
    ["an unknown field", { ...customer, kyc_tier: 3 }],
    ["no consent", { ...customer, kyc_consent: false }],
    ["a missing BVN", { ...customer, bvn: undefined }],
    ["a 10-digit BVN", { ...customer, bvn: "1234567890" }],
    ["digits in a name", { ...customer, first_name: "Ad4" }],
    ["markup in a name", { ...customer, last_name: "<b>Obi</b>" }],
    ["a malformed date", { ...customer, date_of_birth: "12/04/1990" }],
    ["an unknown ID type", { ...customer, identity: { ...customer.identity, type: "LIBRARY_CARD" } }],
    ["an extra identity field", { ...customer, identity: { ...customer.identity, verified: true } }],
  ])("refuses %s", (_name, body) => {
    expect(customerCreateSchema.safeParse(body).success).toBe(false);
  });

  it("lets an update carry only metadata, and nothing unknown", () => {
    expect(customerUpdateSchema.safeParse({ metadata: { crm_id: "77" } }).success).toBe(true);
    expect(customerUpdateSchema.safeParse({ kyc_status: "verified" }).success).toBe(false);
  });

  it("caps metadata and references", () => {
    expect(metadataSchema.safeParse(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]))).success).toBe(false);
    expect(metadataSchema.safeParse({ "bad key!": "v" }).success).toBe(false);
    expect(metadataSchema.safeParse({ k: "x".repeat(501) }).success).toBe(false);
    expect(referenceSchema.safeParse("order-123/abc").success).toBe(true);
    expect(referenceSchema.safeParse("has space").success).toBe(false);
  });

  it("only takes whole, positive amounts", () => {
    for (const bad of [0, -5, 1.5, "100", Number.MAX_SAFE_INTEGER]) expect(amountSchema.safeParse(bad).success).toBe(false);
    expect(amountSchema.safeParse(150_000).success).toBe(true);
  });

  it("needs two different currencies for a quote", () => {
    expect(quoteSchema.safeParse({ from_currency: "NGN", to_currency: "USD", amount: 100_000 }).success).toBe(true);
    expect(quoteSchema.safeParse({ from_currency: "NGN", to_currency: "NGN", amount: 100_000 }).success).toBe(false);
    expect(quoteSchema.safeParse({ from_currency: "NGN", to_currency: "EUR", amount: 100_000 }).success).toBe(false);
  });

  it("collapses webhook event lists and refuses unknown or dashboard-only events", () => {
    expect(endpointCreateSchema.parse({ mode: "test", url: "https://a.ng/h", events: ["*", "deposit.received"] }).events).toEqual(["*"]);
    expect(endpointCreateSchema.parse({ mode: "test", url: "https://a.ng/h" }).events).toEqual(["*"]);
    expect(endpointCreateSchema.safeParse({ mode: "test", url: "https://a.ng/h", events: ["account.deleted"] }).success).toBe(false);
    expect(endpointCreateSchema.safeParse({ mode: "test", url: "https://a.ng/h", events: ["ping"] }).success).toBe(false);
  });
});

describe("unique-violation detection", () => {
  it("reads the clashing key's columns from a Postgres error and ignores other errors", () => {
    // The shape a raw query's unique violation really has (Prisma 5).
    const pg = { code: "P2010", meta: { code: "23505", message: "Key (account_id, mode, bvn_fingerprint)=(a, test, f) already exists." } };
    expect(uniqueViolation(pg)).toEqual(["account_id", "mode", "bvn_fingerprint"]);
    expect(uniqueViolation({ code: "P2010", meta: { code: "40P01", message: "deadlock detected" } })).toBeNull();
    expect(uniqueViolation(new Error("timeout"))).toBeNull();
  });
});
