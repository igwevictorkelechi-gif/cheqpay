// Integration tests for payment requests against a real Postgres.
//
// Skipped unless DEVAPI_DB_TESTS=1 and DATABASE_URL point at a disposable
// database with the app schema:
//
//   DEVAPI_DB_TESTS=1 PAYMENT_PROVIDER=mock DATABASE_URL=postgresql://… DIRECT_URL=… \
//     npx vitest run src/lib/devapi/devapi.p5.int.test.ts
//
// What they prove: a payment request gets a one-off account number with no
// customer or KYC; money that arrives (simulated, or a verified live
// collection) credits the developer's main NGN wallet less the deposit fee,
// exactly once per partner transaction, and sends payment_request.paid;
// unpaid requests expire; late money is still credited; the ledger balances.

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.PII_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  return { createDynamic: vi.fn(), verifyTx: vi.fn() };
});

vi.mock("../maplerad/accounts", async (orig) => ({
  ...(await orig<typeof import("../maplerad/accounts")>()),
  createDynamicAccount: h.createDynamic,
}));
vi.mock("../maplerad/transactions", async (orig) => ({
  ...(await orig<typeof import("../maplerad/transactions")>()),
  verifyTransaction: h.verifyTx,
}));

import { prisma } from "@cheqpay/db";
import { fromPublicId, toPublicId } from "@cheqpay/devapi";
import { setFeatureFlags } from "../features";
import { __resetRateLimits } from "../ratelimit";
import { settleCollectionById } from "../maplerad/settle";
import { ensureDevApiSchema } from "./ensureDevApi";
import { createAccount } from "./accounts";
import { createApiKey, invalidateKeyCache } from "./keys";
import { ensureMainWallets, findLedgerMismatches, getMainWallet } from "./ledger";
import { __resetAuthGuard } from "./authGuard";
import { expireDuePaymentRequests } from "./paymentRequests";
import { PLAN_DEFAULTS } from "./plans";
import type { AccountRow } from "./types";

import { GET as listRoute, POST as createRoute } from "../../app/v1/payment_requests/route";
import { GET as getRoute } from "../../app/v1/payment_requests/[id]/route";
import { POST as payRoute } from "../../app/v1/test_helpers/payment_requests/[id]/pay/route";
import { GET as getTransactionRoute } from "../../app/v1/transactions/[id]/route";

const RUN = process.env.DEVAPI_DB_TESTS === "1";
const tag = randomBytes(4).toString("hex");
const IP = "102.89.20.35";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const json = async (r: Response) => (await r.json()) as Json;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const idem = () => `k-${randomBytes(8).toString("hex")}`;

function api(path: string, key: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${key}`);
  headers.set("x-forwarded-for", IP);
  return new Request(`https://api.mycheqpay.com${path}`, { ...init, headers });
}
function post(path: string, key: string, body: unknown = {}, k: string = idem()) {
  return api(path, key, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "idempotency-key": k } });
}
async function balance(walletUuid: string): Promise<bigint> {
  return (await prisma.$queryRawUnsafe<{ available_minor: bigint }[]>(`SELECT available_minor FROM dev_wallets WHERE id = $1::uuid`, walletUuid))[0].available_minor;
}
async function events(accountId: string, type: string, id: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM dev_events WHERE account_id = $1::uuid AND type = $2 AND data::text LIKE $3`,
    accountId,
    type,
    `%${id}%`,
  );
  return Number(rows[0].n);
}

const GROWTH = PLAN_DEFAULTS.growth;
const fee = (amount: number) => Math.min(Math.floor((amount * GROWTH.depositFeeBps) / 10_000), GROWTH.depositFeeCapMinor);

let acct: AccountRow;
let otherAcct: AccountRow;
let key: string;
let otherKey: string;

describe.skipIf(!RUN)("developer API payment requests against Postgres", () => {
  beforeAll(async () => {
    await ensureDevApiSchema();
    await setFeatureFlags({ developer_api: true, ngn_deposits: true } as never, "test");
    const owner = await prisma.user.create({ data: { email: `p5-${tag}@x.test`, kycTier: 2 } });
    const other = await prisma.user.create({ data: { email: `p5b-${tag}@x.test`, kycTier: 1 } });
    acct = await createAccount(owner.id, { businessName: `Acme ${tag}` });
    otherAcct = await createAccount(other.id, { businessName: `Rival ${tag}` });
    await prisma.$executeRawUnsafe(
      `INSERT INTO dev_subscriptions (account_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1::uuid, 'growth', 'active', now(), now() + interval '30 days')`,
      acct.id,
    );
    key = (await createApiKey(acct, { mode: "test", label: "server" })).secret;
    otherKey = (await createApiKey(otherAcct, { mode: "test", label: "rival" })).secret;
  });

  beforeEach(() => {
    __resetRateLimits();
    __resetAuthGuard();
  });

  afterAll(async () => {
    delete process.env.MAPLERAD_DYNAMIC_ACCOUNT_BANK;
    await setFeatureFlags({ developer_api: false } as never, "test");
  });

  describe("test mode", () => {
    let prId = "";
    let mainNgn = "";

    beforeAll(async () => {
      await ensureMainWallets(prisma, acct.id, "test");
      mainNgn = (await getMainWallet(prisma, acct.id, "test", "NGN"))!.id;
    });

    it("gives a one-off account number for an amount, with no customer", async () => {
      const k = idem();
      const res = await createRoute(
        post("/v1/payment_requests", key, { amount: 200_000, account_name: "alignment Pro", description: "Pro, 30 days", reference: `pr-${tag}`, metadata: { user_id: "u1" } }, k),
      );
      expect(res.status).toBe(201);
      const pr = await json(res);
      prId = pr.id;
      expect(pr).toMatchObject({
        object: "payment_request",
        status: "pending",
        currency: "NGN",
        amount: 200_000,
        amount_paid: 0,
        fee: 0,
        bank_name: "CheqPay Test Bank",
        account_name: `Acme ${tag} / alignment Pro`,
        reference: `pr-${tag}`,
        metadata: { user_id: "u1" },
        transaction_id: null,
        livemode: false,
        paid_at: null,
      });
      expect(pr.id).toMatch(/^pr_[0-9a-f]{32}$/);
      expect(pr.account_number).toMatch(/^99\d{8}$/);
      const minutes = (new Date(pr.expires_at).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(58);
      expect(minutes).toBeLessThan(61);

      // Same key: the same request back, not a second one.
      const again = await createRoute(
        post("/v1/payment_requests", key, { amount: 200_000, account_name: "alignment Pro", description: "Pro, 30 days", reference: `pr-${tag}`, metadata: { user_id: "u1" } }, k),
      );
      expect(again.headers.get("idempotent-replayed")).toBe("true");
      expect((await json(again)).id).toBe(prId);
    });

    it("refuses bad input and a reused reference", async () => {
      const bad = async (body: unknown) => (await json(await createRoute(post("/v1/payment_requests", key, body)))).error.code;
      expect(await bad({ amount: 9_999 })).toBe("validation_error");
      expect(await bad({ amount: 1_000_000_001 })).toBe("validation_error");
      expect(await bad({ amount: 200_000, expires_in: 60 })).toBe("validation_error");
      expect(await bad({ amount: 200_000, account_name: "<script>" })).toBe("validation_error");
      expect(await bad({ amount: 200_000, customer_id: "cus_x" })).toBe("validation_error");
      const dup = await createRoute(post("/v1/payment_requests", key, { amount: 300_000, reference: `pr-${tag}` }));
      expect(dup.status).toBe(409);
      expect((await json(dup)).error.code).toBe("duplicate_reference");
    });

    it("is readable by its owner only", async () => {
      expect((await json(await getRoute(api(`/v1/payment_requests/${prId}`, key), params({ id: prId })))).status).toBe("pending");
      const other = await getRoute(api(`/v1/payment_requests/${prId}`, otherKey), params({ id: prId }));
      expect(other.status).toBe(404);
      const list = await json(await listRoute(api(`/v1/payment_requests?status=pending&reference=pr-${tag}`, key)));
      expect(list.data.map((p: Json) => p.id)).toEqual([prId]);
      expect((await json(await listRoute(api(`/v1/payment_requests?reference=pr-${tag}`, otherKey)))).data).toEqual([]);
    });

    it("credits the main NGN wallet less the deposit fee and sends payment_request.paid", async () => {
      const before = await balance(mainNgn);
      const res = await payRoute(post(`/v1/test_helpers/payment_requests/${prId}/pay`, key, { sender_name: "Tunde Bakare" }), params({ id: prId }));
      expect(res.status).toBe(201);
      const pr = await json(res);
      expect(pr).toMatchObject({ status: "paid", amount: 200_000, amount_paid: 200_000, fee: fee(200_000) });
      expect(pr.paid_at).toBeTruthy();
      expect((await balance(mainNgn)) - before).toBe(BigInt(200_000 - fee(200_000)));
      expect(await events(acct.id, "payment_request.paid", prId)).toBe(1);

      const tx = await json(await getTransactionRoute(api(`/v1/transactions/${pr.transaction_id}`, key), params({ id: pr.transaction_id })));
      expect(tx).toMatchObject({ kind: "payment", status: "successful", amount: 200_000, fee: fee(200_000), customer_id: null });
      expect(tx.details).toMatchObject({ payment_request_id: prId, payer: { name: "Tunde Bakare" } });
      expect(tx.wallet_id).toBe(toPublicId("wallet", mainNgn));
    });

    it("adds up a second transfer to the same account number", async () => {
      const before = await balance(mainNgn);
      const pr = await json(await payRoute(post(`/v1/test_helpers/payment_requests/${prId}/pay`, key, { amount: 50_000 }), params({ id: prId })));
      expect(pr).toMatchObject({ status: "paid", amount_paid: 250_000, fee: fee(200_000) + fee(50_000) });
      expect((await balance(mainNgn)) - before).toBe(BigInt(50_000 - fee(50_000)));
    });

    it("expires unpaid requests, and still credits money that arrives late", async () => {
      const pr = await json(await createRoute(post("/v1/payment_requests", key, { amount: 150_000, expires_in: 900 })));
      await prisma.$executeRawUnsafe(`UPDATE dev_payment_requests SET expires_at = now() - interval '1 second' WHERE id = $1::uuid`, fromPublicId("payment_request", pr.id));
      const swept = await expireDuePaymentRequests();
      expect(swept.expired).toBeGreaterThanOrEqual(1);
      expect((await json(await getRoute(api(`/v1/payment_requests/${pr.id}`, key), params({ id: pr.id })))).status).toBe("expired");
      expect(await events(acct.id, "payment_request.expired", pr.id)).toBe(1);
      // Sweeping again sends nothing new.
      await expireDuePaymentRequests();
      expect(await events(acct.id, "payment_request.expired", pr.id)).toBe(1);

      const before = await balance(mainNgn);
      const late = await json(await payRoute(post(`/v1/test_helpers/payment_requests/${pr.id}/pay`, key), params({ id: pr.id })));
      expect(late).toMatchObject({ status: "paid", amount_paid: 150_000 });
      expect((await balance(mainNgn)) - before).toBe(BigInt(150_000 - fee(150_000)));
    });

    it("can't pay someone else's request", async () => {
      const res = await payRoute(post(`/v1/test_helpers/payment_requests/${prId}/pay`, otherKey), params({ id: prId }));
      expect(res.status).toBe(404);
    });
  });

  describe("live mode (the banking partner is mocked)", () => {
    let liveKey = "";
    let liveMain = "";
    let livePr = "";

    beforeAll(async () => {
      await prisma.$executeRawUnsafe(`UPDATE dev_accounts SET status = 'approved', live_since = now(), reviewed_at = now() WHERE id = $1::uuid`, acct.id);
      invalidateKeyCache();
      acct = (await prisma.$queryRawUnsafe<AccountRow[]>(`SELECT * FROM dev_accounts WHERE id = $1::uuid`, acct.id))[0];
      await ensureMainWallets(prisma, acct.id, "live");
      liveMain = (await getMainWallet(prisma, acct.id, "live", "NGN"))!.id;
      liveKey = (await createApiKey(acct, { mode: "live", label: "prod" })).secret;
    });

    it("isn't offered until the bank for dynamic accounts is configured", async () => {
      delete process.env.MAPLERAD_DYNAMIC_ACCOUNT_BANK;
      delete process.env.MAPLERAD_PREFERRED_BANK;
      const res = await createRoute(post("/v1/payment_requests", liveKey, { amount: 200_000 }));
      expect(res.status).toBe(503);
      expect((await json(res)).error.code).toBe("feature_disabled");
      expect(h.createDynamic).not.toHaveBeenCalled();
    });

    it("opens a dynamic account at the partner for the amount", async () => {
      process.env.MAPLERAD_DYNAMIC_ACCOUNT_BANK = "MONIEPOINT";
      h.createDynamic.mockResolvedValueOnce({ id: `mpl_dyn_${tag}`, account_number: "5012345678", bank_name: "Partner Bank", account_name: `ACME ${tag} / ALIGNMENT PRO`, currency: "NGN" });
      const res = await createRoute(post("/v1/payment_requests", liveKey, { amount: 200_000, account_name: "alignment Pro" }));
      expect(res.status).toBe(201);
      const pr = await json(res);
      livePr = pr.id;
      expect(pr).toMatchObject({ status: "pending", account_number: "5012345678", bank_name: "Partner Bank", livemode: true });
      expect(h.createDynamic).toHaveBeenCalledWith({ accountName: `Acme ${tag} / alignment Pro`, preferredBank: "MONIEPOINT", amount: 200_000 });
    });

    it("answers 503 and creates nothing usable when the partner fails", async () => {
      h.createDynamic.mockRejectedValueOnce(new Error("partner timeout"));
      const res = await createRoute(post("/v1/payment_requests", liveKey, { amount: 200_000, reference: `fail-${tag}` }));
      expect(res.status).toBe(503);
      expect((await json(res)).error.code).toBe("service_unavailable");
      expect((await json(await listRoute(api(`/v1/payment_requests?reference=fail-${tag}`, liveKey)))).data).toEqual([]);
    });

    it("credits a verified collection into the dynamic account exactly once", async () => {
      const txId = `mpl_tx_pr_${tag}`;
      h.verifyTx.mockResolvedValue({
        id: txId,
        status: "SUCCESS",
        entry: "CREDIT",
        type: "COLLECTION",
        amount: 200_000,
        currency: "NGN",
        account_id: `mpl_dyn_${tag}`,
        source: { account_name: "ADA OBI", account_number: "0099887766", bank_name: "Some Bank" },
      });
      const before = await balance(liveMain);
      expect((await settleCollectionById(txId)).outcome).toBe("credited");
      expect((await settleCollectionById(txId)).outcome).toBe("duplicate");
      expect((await balance(liveMain)) - before).toBe(BigInt(200_000 - fee(200_000)));
      const pr = await json(await getRoute(api(`/v1/payment_requests/${livePr}`, liveKey), params({ id: livePr })));
      expect(pr).toMatchObject({ status: "paid", amount_paid: 200_000 });
      expect(await events(acct.id, "payment_request.paid", livePr)).toBe(1);
    });

    it("has no test helper in live mode", async () => {
      const res = await payRoute(post(`/v1/test_helpers/payment_requests/${livePr}/pay`, liveKey), params({ id: livePr }));
      expect(res.status).toBe(404);
    });
  });

  it("keeps every wallet balance equal to its ledger", async () => {
    // Other suites corrupt balances on purpose to test the freeze; only this suite's accounts matter here.
    const ours = new Set(
      (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM dev_wallets WHERE account_id = ANY($1::uuid[])`, [acct.id, otherAcct.id])).map((w) => w.id),
    );
    expect((await findLedgerMismatches()).filter((m) => ours.has(m.wallet_id))).toEqual([]);
    expect(ours.size).toBeGreaterThan(0);
  });
});
