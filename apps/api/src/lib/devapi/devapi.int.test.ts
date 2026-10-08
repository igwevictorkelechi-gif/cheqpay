// Integration tests for the developer platform against a real Postgres.
//
// Skipped unless DEVAPI_DB_TESTS=1 and DATABASE_URL point at a disposable
// database with the app schema (they create users, wallets and money rows):
//
//   DEVAPI_DB_TESTS=1 PAYMENT_PROVIDER=mock DATABASE_URL=postgresql://… DIRECT_URL=… \
//     npx vitest run src/lib/devapi/devapi.int.test.ts
//
// What they prove, beyond the unit tests: the database enforces the ledger
// rules on its own (append-only, never negative, exactly once), the request
// gate holds end to end (isolation, scopes, keys, IPs, browsers, URLs, rate
// limits), and the money moves between the app and developer ledgers stay
// balanced.

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.PII_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  return {
    user: { id: "", email: "", aal: "aal1" as string },
    emails: [] as { to: string; subject: string }[],
  };
});

vi.mock("../auth", async (orig) => ({
  ...(await orig<typeof import("../auth")>()),
  requireUser: vi.fn(async () => ({ id: h.user.id, email: h.user.email, aal: h.user.aal, emailConfirmed: true })),
}));
vi.mock("../email", () => ({
  isEmailConfigured: () => true,
  assertEmailConfigured: () => undefined,
  sendEmail: vi.fn(async (m: { to: string; subject: string }) => {
    h.emails.push({ to: m.to, subject: m.subject });
    return { id: "e" };
  }),
}));

import { Asset, TransactionType, prisma } from "@cheqpay/db";
import { toPublicId } from "@cheqpay/devapi";
import { z } from "zod";
import { setFeatureFlags } from "../features";
import { setTransactionPin } from "../transactionPin";
import { __resetRateLimits } from "../ratelimit";
import { ensureDevApiSchema } from "./ensureDevApi";
import { adminAccountAction, createAccount, emergencyStop, reviewApplication, submitApplication } from "./accounts";
import { createApiKey, invalidateKeyCache, revokeApiKey } from "./keys";
import { applyLegs, findLedgerMismatches, getMainWallet, insertTransaction } from "./ledger";
import { renewDueSubscriptions } from "./billing";
import { runDevelopersDaily } from "./cron";
import { withApi } from "./handler";
import { __resetAuthGuard } from "./authGuard";
import { GET as getAccountRoute } from "../../app/v1/account/route";
import { GET as listWalletsRoute } from "../../app/v1/wallets/route";
import { GET as getWalletRoute } from "../../app/v1/wallets/[id]/route";
import { GET as listTransactionsRoute } from "../../app/v1/transactions/route";
import { GET as getTransactionRoute } from "../../app/v1/transactions/[id]/route";
import { POST as moveRoute } from "../../app/api/developer/wallet/move/route";
import { POST as createKeyRoute } from "../../app/api/developer/keys/route";
import { POST as subscribeRoute } from "../../app/api/developer/subscription/route";
import { POST as resumeRoute } from "../../app/api/developer/resume/route";
import type { AccountRow } from "./types";

const RUN = process.env.DEVAPI_DB_TESTS === "1";
const tag = randomBytes(4).toString("hex");
const PIN = "739214";
const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]).toString("base64")}`;

let owner: { id: string; email: string };
let other: { id: string; email: string };
let acct: AccountRow;
let otherAcct: AccountRow;
let testKey: string;
let otherKey: string;

const IP = "102.89.10.20";
function api(path: string, key: string | null, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  if (key) headers.set("authorization", `Bearer ${key}`);
  headers.set("x-forwarded-for", init.ip ?? IP);
  return new Request(`https://api.mycheqpay.com${path}`, { ...init, headers });
}
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
// Response bodies are read by shape in assertions; a loose type keeps them short.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const settle = () => new Promise((r) => setTimeout(r, 250));

async function appBalance(userId: string, asset: Asset) {
  return (await prisma.balance.findUnique({ where: { userId_asset: { userId, asset } } }))?.available ?? 0n;
}
async function reload(id: string): Promise<AccountRow> {
  invalidateKeyCache();
  return (await prisma.$queryRawUnsafe<AccountRow[]>(`SELECT * FROM dev_accounts WHERE id = $1::uuid`, id))[0];
}
function dashboard(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://api.mycheqpay.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": IP, ...headers },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!RUN)("developer platform against Postgres", () => {
  beforeAll(async () => {
    await ensureDevApiSchema();
    await setFeatureFlags({ developer_api: true } as never, "test");
    owner = await prisma.user.create({ data: { email: `dev-${tag}@x.test`, kycTier: 2 } });
    other = await prisma.user.create({ data: { email: `dev2-${tag}@x.test`, kycTier: 1 } });
    await setTransactionPin(owner.id, PIN);
    await prisma.balance.create({ data: { userId: owner.id, asset: Asset.NGN, available: 50_000_000n } });
    acct = await createAccount(owner.id, { businessName: `Acme ${tag}` });
    otherAcct = await createAccount(other.id, { businessName: `Rival ${tag}` });
    testKey = (await createApiKey(acct, { mode: "test", label: "server" })).secret;
    otherKey = (await createApiKey(otherAcct, { mode: "test", label: "rival" })).secret;
  });

  beforeEach(() => {
    __resetRateLimits();
    __resetAuthGuard();
    h.user = { id: owner.id, email: owner.email, aal: "aal2" };
  });

  afterAll(async () => {
    await setFeatureFlags({ developer_api: false } as never, "test");
  });

  describe("sandbox accounts", () => {
    it("open with simulated balances that their ledger proves", async () => {
      const ngn = await getMainWallet(prisma, acct.id, "test", "NGN");
      const usd = await getMainWallet(prisma, acct.id, "test", "USD");
      expect(ngn?.available_minor).toBe(100_000_000n);
      expect(usd?.available_minor).toBe(100_000n);
      expect(await createAccount(owner.id, { businessName: "Again" })).toMatchObject({ id: acct.id });
      const mine = (await findLedgerMismatches()).filter((m) => m.account_id === acct.id);
      expect(mine).toEqual([]);
    });
  });

  describe("the request gate", () => {
    it("serves a valid test key, with the documented headers", async () => {
      const res = await getAccountRoute(api("/v1/account", testKey));
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ object: "account", id: toPublicId("account", acct.id), mode: "test", livemode: false });
      expect(res.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{32}$/);
      expect(res.headers.get("cheqpay-mode")).toBe("test");
      expect(res.headers.get("ratelimit-limit")).toBe("60");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("gives every bad key the same generic 401", async () => {
      for (const auth of [null, "nonsense", `cp_test_sk_${"A".repeat(43)}`]) {
        const res = await getAccountRoute(api("/v1/account", auth));
        expect(res.status).toBe(401);
        expect((await json(res)).error).toMatchObject({ type: "authentication_error", code: "invalid_api_key" });
      }
    });

    it("refuses browsers outright", async () => {
      const res = await getAccountRoute(api("/v1/account", testKey, { headers: { origin: "https://evil.example" } }));
      expect(res.status).toBe(403);
      expect((await json(res)).error.code).toBe("browser_requests_not_allowed");
    });

    it("revokes a key the moment it is seen in a URL", async () => {
      const leaked = (await createApiKey(acct, { mode: "test", label: "leaky" })).secret;
      const res = await getAccountRoute(api(`/v1/account?key=${leaked}`, null));
      expect(res.status).toBe(400);
      expect((await json(res)).error.code).toBe("key_in_url");
      const after = await getAccountRoute(api("/v1/account", leaked));
      expect(after.status).toBe(401);
      await settle();
      expect(h.emails.some((e) => e.subject.includes("API key was revoked"))).toBe(true);
    });

    it("checks scopes", async () => {
      const narrow = (await createApiKey(acct, { mode: "test", label: "wallets only", scopes: ["wallets:read"] })).secret;
      expect((await listWalletsRoute(api("/v1/wallets", narrow))).status).toBe(200);
      const res = await getAccountRoute(api("/v1/account", narrow));
      expect(res.status).toBe(403);
      expect((await json(res)).error.code).toBe("insufficient_scope");
    });

    it("refuses a revoked key and logs why for the owner only", async () => {
      const { key, secret } = await createApiKey(acct, { mode: "test", label: "soon revoked" });
      await revokeApiKey(acct.id, key.id, "test");
      const res = await getAccountRoute(api("/v1/account", secret));
      expect(res.status).toBe(401);
      expect(JSON.stringify(await json(res))).not.toContain("revoked");
      await settle();
      const logs = await prisma.$queryRawUnsafe<{ auth_failure: string }[]>(
        `SELECT auth_failure FROM dev_request_logs WHERE key_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
        key.id,
      );
      expect(logs[0]?.auth_failure).toBe("revoked");
    });

    it("enforces a key's IP allowlist", async () => {
      const pinned = (await createApiKey(acct, { mode: "test", label: "pinned", allowedIps: ["203.0.113.7"] })).secret;
      expect((await getAccountRoute(api("/v1/account", pinned, { ip: "198.51.100.9" }))).status).toBe(401);
      expect((await getAccountRoute(api("/v1/account", pinned, { ip: "203.0.113.7" }))).status).toBe(200);
    });

    it("blocks an IP after 20 failed authentications, even for a valid key", async () => {
      const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
      for (let i = 0; i < 20; i++) await getAccountRoute(api("/v1/account", `cp_test_sk_${randomBytes(32).toString("base64url")}`, { ip }));
      __resetAuthGuard(); // prove the block lives in the database, not this server's memory
      const res = await getAccountRoute(api("/v1/account", testKey, { ip }));
      expect(res.status).toBe(429);
      expect((await json(res)).error.code).toBe("too_many_failed_attempts");
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      await prisma.$executeRawUnsafe(`DELETE FROM dev_auth_failures WHERE ip = $1`, ip);
    });

    it("rate-limits per key with Retry-After", async () => {
      const k = (await createApiKey(acct, { mode: "test", label: "busy" })).secret;
      let last: Response | null = null;
      for (let i = 0; i < 61; i++) last = await getAccountRoute(api("/v1/account", k));
      expect(last!.status).toBe(429);
      expect(last!.headers.get("retry-after")).toBeTruthy();
      expect(last!.headers.get("ratelimit-remaining")).toBe("0");
    });

    it("refuses live keys until the business is approved", async () => {
      const live = (await createApiKey(acct, { mode: "live", label: "too early" })).secret;
      const res = await getAccountRoute(api("/v1/account", live));
      expect(res.status).toBe(403);
      expect((await json(res)).error.code).toBe("account_not_approved");
    });

    it("is off entirely when the feature is switched off", async () => {
      await setFeatureFlags({ developer_api: false } as never, "test");
      expect((await getAccountRoute(api("/v1/account", testKey))).status).toBe(503);
      await setFeatureFlags({ developer_api: true } as never, "test");
    });

    it("rejects malformed bodies before a handler runs", async () => {
      const probe = withApi(
        { scope: "account:read", body: z.object({ amount: z.number().int() }).strict(), logFields: ["amount"] },
        async (ctx) => ({ body: { got: ctx.body } }),
      );
      const post = (body: string, headers: Record<string, string> = {}) =>
        probe(api("/v1/probe", testKey, { method: "POST", body, headers: { "content-type": "application/json", "idempotency-key": `k-${randomBytes(4).toString("hex")}`, ...headers } }));
      expect((await json(await post('{"amount":5}'))).got).toEqual({ amount: 5 });
      expect((await json(await post('{"amount":5,"admin":true}'))).error.code).toBe("validation_error");
      expect((await json(await post("{nope"))).error.code).toBe("invalid_json");
      expect((await post('{"amount":5}', { "content-type": "text/plain" })).status).toBe(415);
      expect((await post(JSON.stringify({ amount: 1, pad: "x".repeat(200_000) }))).status).toBe(413);
      expect((await json(await post('{"amount":5}', { "idempotency-key": "cp:renew" }))).error.code).toBe("idempotency_key_required");
      const noKey = await probe(api("/v1/probe", testKey, { method: "POST", body: '{"amount":5}', headers: { "content-type": "application/json" } }));
      expect((await json(noKey)).error.code).toBe("idempotency_key_required");
    });
  });

  describe("tenant and mode isolation", () => {
    it("never shows one account's objects to another", async () => {
      const mine = await getMainWallet(prisma, acct.id, "test", "NGN");
      const theirs = await getMainWallet(prisma, otherAcct.id, "test", "NGN");
      const ok = await getWalletRoute(api("/x", testKey), params({ id: toPublicId("wallet", mine!.id) }));
      expect(ok.status).toBe(200);
      const res = await getWalletRoute(api("/x", testKey), params({ id: toPublicId("wallet", theirs!.id) }));
      expect(res.status).toBe(404);
      const list = await json(await listWalletsRoute(api("/v1/wallets", otherKey)));
      expect(list.data.map((w: { id: string }) => w.id)).not.toContain(toPublicId("wallet", mine!.id));

      const txs = await json(await listTransactionsRoute(api("/v1/transactions", testKey)));
      const theirTx = await json(await listTransactionsRoute(api("/v1/transactions", otherKey)));
      const theirId = theirTx.data[0].id;
      expect(txs.data.map((t: { id: string }) => t.id)).not.toContain(theirId);
      expect((await getTransactionRoute(api("/x", testKey), params({ id: theirId }))).status).toBe(404);
      // Someone else's cursor finds nothing rather than leaking a neighbour.
      const page = await json(await listTransactionsRoute(api(`/v1/transactions?starting_after=${theirId}`, testKey)));
      expect(page.data).toEqual([]);
    });
  });

  describe("the ledger", () => {
    it("is append-only, enforced by the database", async () => {
      await expect(prisma.$executeRawUnsafe(`UPDATE dev_ledger_entries SET amount_minor = 1 WHERE id = (SELECT min(id) FROM dev_ledger_entries)`)).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM dev_ledger_entries WHERE id = (SELECT min(id) FROM dev_ledger_entries)`)).rejects.toThrow(/append-only/);
    });

    it("never goes negative and never double-spends under 50 parallel debits", async () => {
      const w = (await getMainWallet(prisma, acct.id, "test", "NGN"))!;
      const start = w.available_minor;
      const each = 3_000_000n;
      const results = await Promise.allSettled(
        Array.from({ length: 50 }, () =>
          prisma.$transaction(async (db) => {
            const id = await insertTransaction(db, { accountId: acct.id, mode: "test", kind: "adjustment", status: "successful", currency: "NGN", amountMinor: each, walletId: w.id });
            await applyLegs(db, { accountId: acct.id, mode: "test" }, id, "NGN", [{ walletId: w.id, amountMinor: -each, kind: "adjustment" }]);
          }, { maxWait: 30_000, timeout: 30_000 }),
        ),
      );
      for (const r of results) {
        if (r.status === "rejected") expect((r.reason as { code?: string }).code).toBe("insufficient_funds");
      }
      const ok = results.filter((r) => r.status === "fulfilled").length;
      expect(ok).toBe(Number(start / each));
      const after = (await getMainWallet(prisma, acct.id, "test", "NGN"))!.available_minor;
      expect(after).toBe(start - BigInt(ok) * each);
      expect(after >= 0n).toBe(true);
      expect((await findLedgerMismatches()).filter((m) => m.account_id === acct.id)).toEqual([]);
    });

    it("refuses to apply the same movement twice", async () => {
      const w = (await getMainWallet(prisma, acct.id, "test", "USD"))!;
      const id = await prisma.$transaction((db) => insertTransaction(db, { accountId: acct.id, mode: "test", kind: "adjustment", status: "successful", currency: "USD", amountMinor: 100n, walletId: w.id }));
      const once = () => prisma.$transaction((db) => applyLegs(db, { accountId: acct.id, mode: "test" }, id, "USD", [{ walletId: w.id, amountMinor: -100n, kind: "adjustment" }]));
      await once();
      await expect(once()).rejects.toThrow();
    });

    it("refuses another account's wallet even inside a movement", async () => {
      const theirs = (await getMainWallet(prisma, otherAcct.id, "test", "NGN"))!;
      await expect(
        prisma.$transaction(async (db) => {
          const id = await insertTransaction(db, { accountId: acct.id, mode: "test", kind: "adjustment", status: "successful", currency: "NGN", amountMinor: 1n });
          await applyLegs(db, { accountId: acct.id, mode: "test" }, id, "NGN", [{ walletId: theirs.id, amountMinor: -1n, kind: "adjustment" }]);
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("catches a tampered balance and freezes the wallet", async () => {
      const w = (await getMainWallet(prisma, otherAcct.id, "test", "USD"))!;
      await prisma.$executeRawUnsafe(`UPDATE dev_wallets SET available_minor = available_minor + 500 WHERE id = $1::uuid`, w.id);
      const out = await runDevelopersDaily();
      expect(out.reconciliation.mismatches).toBeGreaterThanOrEqual(1);
      const frozen = (await getMainWallet(prisma, otherAcct.id, "test", "USD"))!;
      expect(frozen.status).toBe("frozen");
      await expect(
        prisma.$transaction(async (db) => {
          const id = await insertTransaction(db, { accountId: otherAcct.id, mode: "test", kind: "adjustment", status: "successful", currency: "USD", amountMinor: 1n, walletId: w.id });
          await applyLegs(db, { accountId: otherAcct.id, mode: "test" }, id, "USD", [{ walletId: w.id, amountMinor: -1n, kind: "adjustment" }]);
        }),
      ).rejects.toMatchObject({ code: "wallet_frozen" });
    });
  });

  describe("going live: application, plan, money", () => {
    it("applies (with 2FA), and is approved by an admin", async () => {
      h.user.aal = "aal1";
      await expect(
        (async () => {
          const { requireStepUp } = await import("./dashboard");
          requireStepUp({ id: owner.id, aal: "aal1" });
        })(),
      ).rejects.toMatchObject({ code: "mfa_required" });
      const app = {
        legal_name: `Acme Payments ${tag} Ltd`,
        rc_number: "RC 1234567",
        business_type: "limited_company",
        website: "https://acme.example",
        use_case: "We sell airtime and data to small shops through our POS app and need wallets for each shop.",
        expected_monthly_volume: "1m_10m",
        contact_phone: "0803 123 4567",
        address: "12 Marina Road, Lagos Island, Lagos",
        cac_document: PNG,
      };
      await expect(submitApplication(acct, { ...app, cac_document: "data:text/html;base64,PHNjcmlwdD4=" }, { userId: owner.id, ip: IP, userAgent: null })).rejects.toBeTruthy();
      await expect(submitApplication(acct, { ...app, cac_document: `data:image/png;base64,${Buffer.from("<script>").toString("base64")}` }, { userId: owner.id, ip: IP, userAgent: null })).rejects.toMatchObject({ code: "file_type_mismatch" });
      acct = await submitApplication(acct, app, { userId: owner.id, ip: IP, userAgent: null });
      expect(acct.status).toBe("pending_review");
      const stored = await prisma.$queryRawUnsafe<{ data_enc: Buffer }[]>(`SELECT data_enc FROM dev_files WHERE id = $1::uuid`, acct.cac_file_id);
      expect(Buffer.from(stored[0].data_enc).includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // encrypted at rest
      acct = await reviewApplication(acct.id, { approve: true, note: "Looks good" }, "admin@cheqpay.test");
      expect(acct.status).toBe("approved");
      expect((await getMainWallet(prisma, acct.id, "live", "NGN"))?.available_minor).toBe(0n);
    });

    it("adds money from the app balance only with 2FA and the PIN, exactly once per key", async () => {
      const body = { direction: "in", currency: "NGN", amount: "200000" };
      h.user.aal = "aal1";
      expect((await json(await moveRoute(dashboard("/api/developer/wallet/move", body, { "idempotency-key": `mv-${tag}-1`, "x-transaction-pin": PIN })))).code).toBe("mfa_required");
      h.user.aal = "aal2";
      expect((await json(await moveRoute(dashboard("/api/developer/wallet/move", body, { "idempotency-key": `mv-${tag}-1` })))).code).toBe("pin_required");
      expect((await json(await moveRoute(dashboard("/api/developer/wallet/move", body, { "idempotency-key": `mv-${tag}-1`, "x-transaction-pin": "1111" })))).code).toBe("pin_incorrect");
      const before = await appBalance(owner.id, Asset.NGN);
      const first = await moveRoute(dashboard("/api/developer/wallet/move", body, { "idempotency-key": `mv-${tag}-1`, "x-transaction-pin": PIN }));
      expect(first.status).toBe(201);
      const again = await moveRoute(dashboard("/api/developer/wallet/move", body, { "idempotency-key": `mv-${tag}-1`, "x-transaction-pin": PIN }));
      expect(again.status).toBe(200);
      expect((await json(again)).replay).toBe(true);
      expect(before - (await appBalance(owner.id, Asset.NGN))).toBe(20_000_000n);
      expect((await getMainWallet(prisma, acct.id, "live", "NGN"))?.available_minor).toBe(20_000_000n);
      const row = await prisma.transaction.findFirst({ where: { userId: owner.id, type: TransactionType.DEV_WALLET_FUND } });
      expect(row?.metadata).toMatchObject({ direction: "in", ip: IP });
    });

    it("refuses to take a wallet over the account's balance cap", async () => {
      await adminAccountAction(acct.id, { action: "set_limits", dailyOutNgnMinor: null, dailyOutUsdMinor: null, maxFloatNgnMinor: 25_000_000n, maxFloatUsdMinor: null }, "admin@cheqpay.test");
      const res = await moveRoute(dashboard("/api/developer/wallet/move", { direction: "in", currency: "NGN", amount: "60000" }, { "idempotency-key": `mv-${tag}-2`, "x-transaction-pin": PIN }));
      expect((await json(res)).code).toBe("limit_exceeded");
      await adminAccountAction(acct.id, { action: "set_limits", dailyOutNgnMinor: null, dailyOutUsdMinor: null, maxFloatNgnMinor: null, maxFloatUsdMinor: null }, "admin@cheqpay.test");
      acct = await reload(acct.id);
    });

    it("moves money back out, never more than the wallet holds", async () => {
      const before = await appBalance(owner.id, Asset.NGN);
      const tooMuch = await moveRoute(dashboard("/api/developer/wallet/move", { direction: "out", currency: "NGN", amount: "999999" }, { "idempotency-key": `mv-${tag}-3`, "x-transaction-pin": PIN }));
      expect((await json(tooMuch)).code).toBe("insufficient_funds");
      expect(await appBalance(owner.id, Asset.NGN)).toBe(before);
      const ok = await moveRoute(dashboard("/api/developer/wallet/move", { direction: "out", currency: "NGN", amount: "10000" }, { "idempotency-key": `mv-${tag}-4`, "x-transaction-pin": PIN }));
      expect(ok.status).toBe(201);
      expect((await appBalance(owner.id, Asset.NGN)) - before).toBe(1_000_000n);
      await settle();
      expect(h.emails.some((e) => e.subject.includes("Money moved out"))).toBe(true);
    });

    it("subscribes from the main wallet with 2FA and the PIN, and charges once", async () => {
      const sub = (planId: string, pin = PIN) => subscribeRoute(dashboard("/api/developer/subscription", { plan_id: planId }, { "x-transaction-pin": pin }));
      const wallet = async () => (await getMainWallet(prisma, acct.id, "live", "NGN"))!.available_minor;
      const before = await wallet();
      const res = await sub("starter");
      expect(res.status).toBe(200);
      expect((await json(res)).change).toMatchObject({ kind: "subscribed", charged: 1_500_000 });
      expect(before - (await wallet())).toBe(1_500_000n);
      expect((await json(await sub("starter"))).change.kind).toBe("unchanged");
      expect(before - (await wallet())).toBe(1_500_000n);
      const up = await json(await sub("growth"));
      expect(up.change.kind).toBe("upgraded");
      expect(up.change.charged).toBeGreaterThan(3_400_000);
      expect(up.change.charged).toBeLessThanOrEqual(3_500_000);
      expect((await json(await sub("starter"))).change.kind).toBe("downgrade_scheduled");
    });

    it("opens live keys once approved and paid, with 2FA", async () => {
      h.user.aal = "aal1";
      expect((await json(await createKeyRoute(dashboard("/api/developer/keys", { mode: "live", label: "prod" })))).code).toBe("mfa_required");
      h.user.aal = "aal2";
      const res = await createKeyRoute(dashboard("/api/developer/keys", { mode: "live", label: "prod" }));
      expect(res.status).toBe(201);
      const { secret } = await json(res);
      const acc = await json(await getAccountRoute(api("/v1/account", secret)));
      expect(acc).toMatchObject({ mode: "live", live_enabled: true, plan: { id: "growth" } });
      expect(acc.limits.daily_outflow.NGN).toBeGreaterThan(0);
      // A key able to reveal card numbers can't exist in live without an allowlist.
      const risky = await createKeyRoute(dashboard("/api/developer/keys", { mode: "live", label: "cards", scopes: ["cards:details"] }));
      expect((await json(risky)).code).toBe("ip_allowlist_required");
    });

    it("renews exactly once, even when two runs overlap", async () => {
      await prisma.$executeRawUnsafe(`UPDATE dev_subscriptions SET current_period_end = now() - interval '1 minute' WHERE account_id = $1::uuid`, acct.id);
      const wallet = async () => (await getMainWallet(prisma, acct.id, "live", "NGN"))!.available_minor;
      const before = await wallet();
      const [a, b] = await Promise.all([renewDueSubscriptions(), renewDueSubscriptions()]);
      expect(a.renewed + b.renewed).toBe(1);
      expect(before - (await wallet())).toBe(1_500_000n); // the scheduled downgrade to Starter took effect
      const subs = await prisma.$queryRawUnsafe<{ plan_id: string; current_period_end: Date }[]>(`SELECT plan_id, current_period_end FROM dev_subscriptions WHERE account_id = $1::uuid`, acct.id);
      expect(subs[0].plan_id).toBe("starter");
      expect(subs[0].current_period_end.getTime()).toBeGreaterThan(Date.now());
    });

    it("falls past due when the wallet is short, keeps a grace period, then stops live keys", async () => {
      const w = (await getMainWallet(prisma, acct.id, "live", "NGN"))!;
      await moveRoute(dashboard("/api/developer/wallet/move", { direction: "out", currency: "NGN", amount: (Number(w.available_minor) / 100).toFixed(2) }, { "idempotency-key": `mv-${tag}-drain`, "x-transaction-pin": PIN }));
      await prisma.$executeRawUnsafe(`UPDATE dev_subscriptions SET current_period_end = now() - interval '1 minute' WHERE account_id = $1::uuid`, acct.id);
      const r = await renewDueSubscriptions();
      expect(r.pastDue).toBeGreaterThanOrEqual(1);
      const live = (await createApiKey(await reload(acct.id), { mode: "live", label: "grace" })).secret;
      expect((await getAccountRoute(api("/v1/account", live))).status).toBe(200);
      await prisma.$executeRawUnsafe(`UPDATE dev_subscriptions SET past_due_since = now() - interval '4 days' WHERE account_id = $1::uuid`, acct.id);
      invalidateKeyCache();
      const res = await getAccountRoute(api("/v1/account", live));
      expect(res.status).toBe(402);
      expect((await json(res)).error.code).toBe("subscription_inactive");
      // Test keys are unaffected by billing.
      expect((await getAccountRoute(api("/v1/account", testKey))).status).toBe(200);
    });

    it("emergency stop revokes live keys at once; lifting it needs 2FA and the PIN", async () => {
      await prisma.$executeRawUnsafe(`UPDATE dev_subscriptions SET past_due_since = NULL, status = 'active', current_period_end = now() + interval '20 days' WHERE account_id = $1::uuid`, acct.id);
      acct = await reload(acct.id);
      const live = (await createApiKey(acct, { mode: "live", label: "panic test" })).secret;
      expect((await getAccountRoute(api("/v1/account", live))).status).toBe(200);
      const { keysRevoked } = await emergencyStop(acct, { userId: owner.id, ip: IP, userAgent: null });
      expect(keysRevoked).toBeGreaterThanOrEqual(1);
      expect((await getAccountRoute(api("/v1/account", live))).status).toBe(401);
      h.user.aal = "aal1";
      expect((await json(await resumeRoute(dashboard("/api/developer/resume", {}, { "x-transaction-pin": PIN })))).code).toBe("mfa_required");
      h.user.aal = "aal2";
      expect((await json(await resumeRoute(dashboard("/api/developer/resume", {})))).code).toBe("pin_required");
      const ok = await resumeRoute(dashboard("/api/developer/resume", {}, { "x-transaction-pin": PIN }));
      expect(ok.status).toBe(200);
      expect((await json(ok)).account.frozen).toBe(false);
    });

    it("cannot be un-frozen by the owner when CheqPay froze it", async () => {
      await adminAccountAction(acct.id, { action: "freeze", reason: "Unusual activity under review" }, "admin@cheqpay.test");
      const res = await resumeRoute(dashboard("/api/developer/resume", {}, { "x-transaction-pin": PIN }));
      expect((await json(res)).code).toBe("frozen_by_cheqpay");
      await adminAccountAction(acct.id, { action: "unfreeze" }, "admin@cheqpay.test");
    });
  });

  describe("what never leaves the server", () => {
    it("request logs keep no secrets", async () => {
      await settle();
      const rows = await prisma.$queryRawUnsafe<{ row: string }[]>(
        `SELECT row_to_json(l)::text AS row FROM dev_request_logs l WHERE account_id = $1::uuid`,
        acct.id,
      );
      expect(rows.length).toBeGreaterThan(5);
      for (const { row } of rows) {
        expect(row).not.toMatch(/cp_(test|live)_sk_[A-Za-z0-9_-]{20,}/);
        expect(row.toLowerCase()).not.toContain("authorization");
      }
    });

    it("key rows hold only a hash", async () => {
      const rows = await prisma.$queryRawUnsafe<{ row: string }[]>(`SELECT row_to_json(k)::text AS row FROM dev_api_keys k WHERE account_id = $1::uuid`, acct.id);
      for (const { row } of rows) expect(row).not.toMatch(/cp_(test|live)_sk_/);
    });
  });
});
