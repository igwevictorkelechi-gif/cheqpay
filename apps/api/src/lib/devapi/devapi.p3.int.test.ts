// Integration tests for phase 3 of the developer API (bill payments) against a
// real Postgres. The bills provider is faked; the gate, the ledger, the limits,
// the settlement paths and the provider webhook route are real.
//
//   DEVAPI_DB_TESTS=1 PAYMENT_PROVIDER=mock DATABASE_URL=postgresql://… DIRECT_URL=… \
//     npx vitest run src/lib/devapi/devapi.p3.int.test.ts

import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.PII_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.VTU_NG_PIN = "4321";
  return {
    providerName: "vtung",
    pay: vi.fn(),
    query: vi.fn(),
    validate: vi.fn(),
  };
});

vi.mock("@/payments", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const fake = {
    get name() {
      return h.providerName;
    },
    payBill: h.pay,
    queryBill: h.query,
    validateBillCustomer: h.validate,
  };
  return { ...actual, getBillsProvider: () => fake, billsProviderNamed: () => fake };
});
vi.mock("../opsAlert", () => ({ alertOpsOnce: vi.fn(async () => undefined) }));

import { prisma } from "@cheqpay/db";
import { fromPublicId, toPublicId } from "@cheqpay/devapi";
import { BillPaymentError } from "@/payments/types";
import { setFeatureFlags } from "../features";
import { __resetRateLimits } from "../ratelimit";
import { settleBillByProviderRef } from "../billSettlement";
import { ensureDevApiSchema } from "./ensureDevApi";
import { createAccount } from "./accounts";
import { createApiKey, invalidateKeyCache } from "./keys";
import { applyLegs, ensureCustomerWallets, ensureMainWallets, findLedgerMismatches, getMainWallet, insertTransaction } from "./ledger";
import { __resetAuthGuard } from "./authGuard";
import { __setWebhookTransportForTests } from "./webhooks";
import { NOT_FOUND_REFUND_AFTER_MS, sweepPendingApiBills } from "./bills";
import { PLAN_DEFAULTS } from "./plans";
import type { AccountRow } from "./types";

import { GET as servicesRoute } from "../../app/v1/bills/services/route";
import { GET as plansRoute } from "../../app/v1/bills/plans/route";
import { POST as validateRoute } from "../../app/v1/bills/validate/route";
import { GET as listPaymentsRoute, POST as payRoute } from "../../app/v1/bills/payments/route";
import { GET as getPaymentRoute } from "../../app/v1/bills/payments/[id]/route";
import { POST as settleRoute } from "../../app/v1/test_helpers/bill_payments/[id]/settle/route";
import { POST as transferRoute } from "../../app/v1/transfers/route";
import { POST as vtuWebhook } from "../../app/api/webhooks/vtung/route";

const RUN = process.env.DEVAPI_DB_TESTS === "1";
const tag = randomBytes(4).toString("hex");
const IP = "102.89.20.31";

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
function postJson(path: string, key: string, body: unknown, k: string = idem()) {
  return api(path, key, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "idempotency-key": k } });
}
async function balance(walletUuid: string): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<{ available_minor: bigint }[]>(`SELECT available_minor FROM dev_wallets WHERE id = $1::uuid`, walletUuid);
  return rows[0].available_minor;
}
async function eventsOf(accountId: string, type: string, txPublicId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM dev_events WHERE account_id = $1::uuid AND type = $2 AND data::text LIKE $3`,
    accountId,
    type,
    `%${txPublicId}%`,
  );
  return Number(rows[0].n);
}
async function credit(accountId: string, mode: "test" | "live", walletId: string, amount: bigint) {
  await prisma.$transaction(async (db) => {
    const id = await insertTransaction(db, { accountId, mode, kind: "adjustment", status: "successful", currency: "NGN", amountMinor: amount, walletId });
    await applyLegs(db, { accountId, mode }, id, "NGN", [{ walletId, amountMinor: amount, kind: "adjustment" }]);
  });
}

const GROWTH = PLAN_DEFAULTS.growth;
const feeOn = (amount: bigint) => {
  const f = (amount * BigInt(GROWTH.billFeeBps)) / 10_000n;
  return GROWTH.billFeeCapMinor > 0 && f > BigInt(GROWTH.billFeeCapMinor) ? BigInt(GROWTH.billFeeCapMinor) : f;
};

let acct: AccountRow;
let otherAcct: AccountRow;
let key: string;
let otherKey: string;
let testMain = "";

describe.skipIf(!RUN)("developer API bill payments against Postgres", () => {
  beforeAll(async () => {
    await ensureDevApiSchema();
    await setFeatureFlags({ developer_api: true, bill_payments: true } as never, "test");
    const owner = await prisma.user.create({ data: { email: `p3-${tag}@x.test`, kycTier: 2 } });
    const other = await prisma.user.create({ data: { email: `p3b-${tag}@x.test`, kycTier: 1 } });
    acct = await createAccount(owner.id, { businessName: `Billco ${tag}` });
    otherAcct = await createAccount(other.id, { businessName: `Other ${tag}` });
    await prisma.$executeRawUnsafe(
      `INSERT INTO dev_subscriptions (account_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1::uuid, 'growth', 'active', now(), now() + interval '30 days')`,
      acct.id,
    );
    key = (await createApiKey(acct, { mode: "test", label: "server" })).secret;
    otherKey = (await createApiKey(otherAcct, { mode: "test", label: "other" })).secret;
    testMain = (await getMainWallet(prisma, acct.id, "test", "NGN"))!.id;
    __setWebhookTransportForTests(async () => ({ status: 200, body: "" }));
  });

  beforeEach(() => {
    __resetRateLimits();
    __resetAuthGuard();
    h.providerName = "vtung";
    h.pay.mockReset();
    h.validate.mockReset();
    h.query.mockReset();
    // The background sweep may run during a request; by default nothing is resolved.
    h.query.mockResolvedValue({ status: "pending", providerStatus: "processing-api" });
  });

  afterAll(async () => {
    __setWebhookTransportForTests(null);
    await setFeatureFlags({ developer_api: false } as never, "test");
  });

  describe("sandbox", () => {
    it("lists the services, billers and plans without touching the provider", async () => {
      const services = await json(await servicesRoute(api("/v1/bills/services", key)));
      expect(services.data.map((s: Json) => s.id)).toEqual(["airtime", "data", "electricity", "cabletv"]);
      const data = services.data.find((s: Json) => s.id === "data");
      expect(data).toMatchObject({ amount_type: "plan", billers: expect.arrayContaining([{ id: "mtn", name: "MTN", available: true }]) });
      const plans = await json(await plansRoute(api("/v1/bills/plans?service=data&biller_id=mtn", key)));
      expect(plans.data.length).toBeGreaterThan(0);
      expect(plans.data[0]).toMatchObject({ object: "bill_plan", biller_id: "mtn", currency: "NGN" });
      expect(Number.isInteger(plans.data[0].amount)).toBe(true);
      expect((await plansRoute(api("/v1/bills/plans?service=airtime&biller_id=mtn", key))).status).toBe(400);
      expect((await plansRoute(api("/v1/bills/plans?service=data&biller_id=nope", key))).status).toBe(404);
      expect(h.pay).not.toHaveBeenCalled();
    });

    it("validates a customer: sandbox numbers ending 0000 are unknown", async () => {
      const ok = await json(await validateRoute(postJson("/v1/bills/validate", key, { service: "electricity", biller_id: "ikedc-prepaid", customer: "4516 0826 181" })));
      expect(ok).toMatchObject({ valid: true, customer: "45160826181", customer_name: "Ada Test" });
      const bad = await json(await validateRoute(postJson("/v1/bills/validate", key, { service: "cabletv", biller_id: "dstv", customer: "7020000000" })));
      expect(bad).toMatchObject({ valid: false, customer_name: null });
      expect(h.validate).not.toHaveBeenCalled();
    });

    it("pays airtime from the main wallet: amount plus the plan's fee, once, with an event", async () => {
      const before = await balance(testMain);
      const k = idem();
      const body = { service: "airtime", biller_id: "mtn", customer: "+234 803 123 4567", amount: 50_000, reference: `air-${tag}` };
      const res = await payRoute(postJson("/v1/bills/payments", key, body, k));
      expect(res.status).toBe(201);
      const tx = await json(res);
      expect(tx).toMatchObject({
        kind: "bill_payment",
        status: "successful",
        amount: 50_000,
        fee: Number(feeOn(50_000n)),
        wallet_id: toPublicId("wallet", testMain),
        details: { service: "airtime", biller_id: "mtn", biller_name: "MTN", customer: "08031234567" },
      });
      expect(tx.details).not.toHaveProperty("bills_provider");
      expect(await balance(testMain)).toBe(before - 50_000n - feeOn(50_000n));
      expect(await eventsOf(acct.id, "bill_payment.successful", tx.id)).toBe(1);

      // Retrying with the same key returns the same payment and charges nothing more.
      const again = await payRoute(postJson("/v1/bills/payments", key, body, k));
      expect((await json(again)).id).toBe(tx.id);
      expect(await balance(testMain)).toBe(before - 50_000n - feeOn(50_000n));
      expect(h.pay).not.toHaveBeenCalled();
    });

    it("prepaid electricity returns the meter token", async () => {
      const tx = await json(await payRoute(postJson("/v1/bills/payments", key, { service: "electricity", biller_id: "ikedc-prepaid", customer: "45160826181", amount: 200_000 })));
      expect(tx.status).toBe("successful");
      expect(tx.details.token).toMatch(/^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/);
    });

    it("pays a data plan at the listed price, and refuses a changed price", async () => {
      const plans = await json(await plansRoute(api("/v1/bills/plans?service=data&biller_id=glo", key)));
      const plan = plans.data[0];
      const ok = await json(await payRoute(postJson("/v1/bills/payments", key, { service: "data", biller_id: "glo", customer: "08051234567", plan_id: plan.id, amount: plan.amount })));
      expect(ok).toMatchObject({ status: "successful", amount: plan.amount, details: { plan_id: plan.id, plan_name: plan.name } });
      const stale = await payRoute(postJson("/v1/bills/payments", key, { service: "data", biller_id: "glo", customer: "08051234567", plan_id: plan.id, amount: plan.amount - 100 }));
      expect(stale.status).toBe(409);
      expect((await json(stale)).error.code).toBe("price_changed");
      const otherBiller = await payRoute(postJson("/v1/bills/payments", key, { service: "data", biller_id: "mtn", customer: "08051234567", plan_id: plan.id }));
      expect(otherBiller.status).toBe(404);
    });

    it("refuses what doesn't fit the service before any money moves", async () => {
      const before = await balance(testMain);
      const cases: [Json, string][] = [
        [{ service: "airtime", biller_id: "mtn", customer: "08031234567", plan_id: "mtn-1gb", amount: 10_000 }, "plan_id"],
        [{ service: "airtime", biller_id: "mtn", customer: "08031234567" }, "amount"],
        [{ service: "airtime", biller_id: "mtn", customer: "08031234567", amount: 10_050 }, "amount"],
        [{ service: "airtime", biller_id: "mtn", customer: "12345678" }, "customer"],
        [{ service: "data", biller_id: "mtn", customer: "08031234567" }, "plan_id"],
        [{ service: "electricity", biller_id: "ikedc-prepaid", customer: "meter-abc", amount: 100_000 }, "customer"],
      ];
      for (const [body, param] of cases) {
        const res = await payRoute(postJson("/v1/bills/payments", key, body));
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect((await json(res)).error.param).toBe(param);
      }
      expect((await payRoute(postJson("/v1/bills/payments", key, { service: "betting", biller_id: "bet9ja", customer: "12345678", amount: 10_000 }))).status).toBe(400);
      expect((await payRoute(postJson("/v1/bills/payments", key, { service: "airtime", biller_id: "nope", customer: "08031234567", amount: 10_000 }))).status).toBe(404);
      expect(await balance(testMain)).toBe(before);
    });

    it("a refused payment refunds the amount and the fee at once", async () => {
      const before = await balance(testMain);
      const res = await payRoute(postJson("/v1/bills/payments", key, { service: "airtime", biller_id: "airtel", customer: "08020000000", amount: 30_000 }));
      expect(res.status).toBe(201);
      const tx = await json(res);
      expect(tx).toMatchObject({ status: "failed", failure: { code: "bill_failed" } });
      expect(await balance(testMain)).toBe(before);
      expect(await eventsOf(acct.id, "bill_payment.failed", tx.id)).toBe(1);
    });

    it("a pending payment holds the money until the test helper settles it, once", async () => {
      const before = await balance(testMain);
      const res = await payRoute(postJson("/v1/bills/payments", key, { service: "airtime", biller_id: "glo", customer: "08051111111", amount: 40_000 }));
      expect(res.status).toBe(202);
      const tx = await json(res);
      expect(tx.status).toBe("pending");
      expect(await balance(testMain)).toBe(before - 40_000n - feeOn(40_000n));

      const failed = await json(await settleRoute(postJson(`/v1/test_helpers/bill_payments/${tx.id}/settle`, key, { outcome: "failed" }), params({ id: tx.id })));
      expect(failed.status).toBe("failed");
      expect(await balance(testMain)).toBe(before);
      // Settling again changes nothing.
      const again = await json(await settleRoute(postJson(`/v1/test_helpers/bill_payments/${tx.id}/settle`, key, { outcome: "successful" }), params({ id: tx.id })));
      expect(again.status).toBe("failed");
      expect(await balance(testMain)).toBe(before);
      expect(await eventsOf(acct.id, "bill_payment.failed", tx.id)).toBe(1);
      expect(await eventsOf(acct.id, "bill_payment.successful", tx.id)).toBe(0);
    });

    it("pays from a customer's wallet, never from a USD wallet or someone else's", async () => {
      const cust = (
        await prisma.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO dev_customers (id, account_id, mode, first_name, last_name, email, phone, bvn_fingerprint, bvn_last4, id_type, kyc_status)
           VALUES (gen_random_uuid(), $1::uuid, 'test', 'Ada', 'Obi', $2, '08031234567', $3, '1234', 'NIN', 'verified') RETURNING id`,
          acct.id,
          `ada-${tag}@x.test`,
          `fp-${tag}`,
        )
      )[0].id;
      await ensureCustomerWallets(prisma, acct.id, "test", cust);
      const wallets = await prisma.$queryRawUnsafe<{ id: string; currency: string }[]>(`SELECT id, currency FROM dev_wallets WHERE customer_id = $1::uuid`, cust);
      const ngn = wallets.find((w) => w.currency === "NGN")!.id;
      const usd = wallets.find((w) => w.currency === "USD")!.id;
      await credit(acct.id, "test", ngn, 100_000n);

      const tx = await json(await payRoute(postJson("/v1/bills/payments", key, { service: "airtime", biller_id: "mtn", customer: "08031234567", amount: 50_000, wallet_id: toPublicId("wallet", ngn) })));
      expect(tx).toMatchObject({ status: "successful", wallet_id: toPublicId("wallet", ngn), customer_id: toPublicId("customer", cust) });
      expect(await balance(ngn)).toBe(100_000n - 50_000n - feeOn(50_000n));

      const usdRes = await payRoute(postJson("/v1/bills/payments", key, { service: "airtime", biller_id: "mtn", customer: "08031234567", amount: 1_000, wallet_id: toPublicId("wallet", usd) }));
      expect((await json(usdRes)).error.code).toBe("currency_mismatch");
      const poor = await payRoute(postJson("/v1/bills/payments", key, { service: "airtime", biller_id: "mtn", customer: "08031234567", amount: 100_000, wallet_id: toPublicId("wallet", ngn) }));
      expect(poor.status).toBe(422);
      expect((await json(poor)).error.code).toBe("insufficient_funds");
      // Another account's key can't name this wallet, or read this payment.
      const theirs = await payRoute(postJson("/v1/bills/payments", otherKey, { service: "airtime", biller_id: "mtn", customer: "08031234567", amount: 1_000, wallet_id: toPublicId("wallet", ngn) }));
      expect(theirs.status).toBe(404);
      expect((await getPaymentRoute(api(`/v1/bills/payments/${tx.id}`, otherKey), params({ id: tx.id }))).status).toBe(404);
    });

    it("lists only bill payments, and won't show another kind as one", async () => {
      const page = await json(await listPaymentsRoute(api("/v1/bills/payments?limit=100", key)));
      expect(page.data.length).toBeGreaterThan(3);
      expect(page.data.every((t: Json) => t.kind === "bill_payment")).toBe(true);
      const cust = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM dev_wallets WHERE account_id = $1::uuid AND mode = 'test' AND customer_id IS NOT NULL AND currency = 'NGN'`, acct.id))[0].id;
      const transfer = await json(await transferRoute(postJson("/v1/transfers", key, { from_wallet_id: toPublicId("wallet", testMain), to_wallet_id: toPublicId("wallet", cust), amount: 100 })));
      expect((await getPaymentRoute(api(`/v1/bills/payments/${transfer.id}`, key), params({ id: transfer.id }))).status).toBe(404);
    });
  });

  describe("live", () => {
    let liveKey = "";
    let liveMain = "";

    beforeAll(async () => {
      await prisma.$executeRawUnsafe(`UPDATE dev_accounts SET status = 'approved', live_since = now() - interval '60 days', reviewed_at = now() WHERE id = $1::uuid`, acct.id);
      invalidateKeyCache();
      await prisma.$transaction(async (db) => ensureMainWallets(db, acct.id, "live"));
      liveMain = (await getMainWallet(prisma, acct.id, "live", "NGN"))!.id;
      await credit(acct.id, "live", liveMain, 5_000_000n); // ₦50,000
      liveKey = (await createApiKey(acct, { mode: "live", label: "prod" })).secret;
    });

    const pay = (body: Json, k?: string) => payRoute(postJson("/v1/bills/payments", liveKey, { service: "airtime", biller_id: "mtn", customer: "08031234567", amount: 10_000, ...body }, k));

    it("sends our transaction id as the reference and settles a successful purchase at once", async () => {
      h.pay.mockImplementationOnce(async (i: { reference: string }) => ({ providerRef: i.reference, status: "successful" }));
      const before = await balance(liveMain);
      const res = await pay({ service: "electricity", biller_id: "ikedc-prepaid", customer: "45160826181", amount: 100_000 });
      expect(res.status).toBe(201);
      const tx = await json(res);
      const sent = h.pay.mock.calls[0][0];
      expect(sent).toMatchObject({ service: "electricity", billerCode: "ikeja-electric:prepaid", customer: "45160826181", amount: "1000", reference: fromPublicId("transaction", tx.id) });
      expect(tx).toMatchObject({ status: "successful", livemode: true });
      expect(await balance(liveMain)).toBe(before - 100_000n - feeOn(100_000n));
    });

    it("refunds a definite refusal straight away", async () => {
      h.pay.mockRejectedValueOnce(new BillPaymentError("refused", "Insufficient wallet balance on vtu.ng", 400));
      const before = await balance(liveMain);
      const tx = await json(await pay({}));
      expect(tx).toMatchObject({ status: "failed", failure: { code: "bill_refused" } });
      expect(tx.failure.message).not.toMatch(/vtu/i);
      expect(await balance(liveMain)).toBe(before);
    });

    it("never refunds an unclear outcome; the provider's webhook settles it, once", async () => {
      h.pay.mockRejectedValueOnce(new Error("The operation was aborted due to timeout"));
      const before = await balance(liveMain);
      const res = await pay({});
      expect(res.status).toBe(202);
      const tx = await json(res);
      expect(tx.status).toBe("pending");
      expect(await balance(liveMain)).toBe(before - 10_000n - feeOn(10_000n));

      const raw = JSON.stringify({ request_id: fromPublicId("transaction", tx.id), status: "completed-api" });
      const sign = (b: string) => createHmac("sha256", "4321").update(b).digest("hex");
      const hook = (b: string) => vtuWebhook(new Request("https://api.mycheqpay.com/api/webhooks/vtung", { method: "POST", body: b, headers: { "x-signature": sign(b) } }));
      expect(await json(await hook(raw))).toMatchObject({ outcome: "completed" });
      expect((await json(await getPaymentRoute(api(`/v1/bills/payments/${tx.id}`, liveKey), params({ id: tx.id })))).status).toBe("successful");
      // A late "refunded" for the same order can't pay the money back on top.
      const late = JSON.stringify({ request_id: fromPublicId("transaction", tx.id), status: "refunded" });
      await hook(late);
      expect(await balance(liveMain)).toBe(before - 10_000n - feeOn(10_000n));
      expect(await eventsOf(acct.id, "bill_payment.successful", tx.id)).toBe(1);
    });

    it("matches the NGN rail's own reference too, and refunds a failed settlement", async () => {
      h.providerName = "maplerad";
      h.pay.mockResolvedValueOnce({ providerRef: `mpl_bill_${tag}`, status: "pending" });
      const before = await balance(liveMain);
      const tx = await json(await pay({}));
      expect(tx.status).toBe("pending");
      const res = await settleBillByProviderRef(`mpl_bill_${tag}`, "failed");
      expect(res).toMatchObject({ outcome: "refunded", transactionId: fromPublicId("transaction", tx.id) });
      expect(await balance(liveMain)).toBe(before);
      expect(await settleBillByProviderRef(`mpl_bill_${tag}`, "failed")).toMatchObject({ outcome: "duplicate" });
      expect(await balance(liveMain)).toBe(before);
    });

    it("the requery sweep settles what the provider answers, and refunds only a long-missing order", async () => {
      h.pay.mockResolvedValue({ providerRef: "", status: "pending" });
      const a = await json(await pay({}));
      const b = await json(await pay({}));
      const c = await json(await pay({}));
      h.pay.mockReset();
      const ids = [a, b, c].map((t) => fromPublicId("transaction", t.id)!);
      await prisma.$executeRawUnsafe(`UPDATE dev_transactions SET created_at = now() - interval '10 minutes' WHERE id = ANY($1::uuid[])`, ids);
      await prisma.$executeRawUnsafe(`UPDATE dev_transactions SET created_at = now() - interval '40 minutes' WHERE id = $1::uuid`, ids[2]);
      const before = await balance(liveMain);
      h.query.mockImplementation(async (ref: string) =>
        ref === ids[0]
          ? { status: "successful", providerStatus: "completed-api", token: null }
          : { status: "not_found", providerStatus: null },
      );
      const r = await sweepPendingApiBills({ olderThanMs: 60_000, limit: 500 });
      expect(r.settled).toBeGreaterThanOrEqual(2);
      const status = async (id: string) => (await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM dev_transactions WHERE id = $1::uuid`, id))[0].status;
      expect(await status(ids[0])).toBe("successful");
      // Not found after 10 minutes may still be in flight: kept. After 40: refunded.
      expect(await status(ids[1])).toBe("pending");
      expect(await status(ids[2])).toBe("failed");
      expect(await balance(liveMain)).toBe(before + 10_000n + feeOn(10_000n));
      expect(NOT_FOUND_REFUND_AFTER_MS).toBe(30 * 60_000);
    });

    it("refuses a biller the provider doesn't carry, and pauses with the bills switch", async () => {
      const before = await balance(liveMain);
      h.providerName = "maplerad";
      // Betting has no biller anywhere; the schema refuses it before the catalogue.
      expect((await pay({ service: "betting", biller_id: "bet9ja" })).status).toBe(400);
      await setFeatureFlags({ bill_payments: false } as never, "test");
      const off = await pay({});
      expect(off.status).toBe(503);
      expect((await json(off)).error.code).toBe("feature_disabled");
      // The sandbox keeps working while live bills are paused.
      expect((await payRoute(postJson("/v1/bills/payments", key, { service: "airtime", biller_id: "mtn", customer: "08031234567", amount: 1_000 }))).status).toBe(201);
      await setFeatureFlags({ bill_payments: true } as never, "test");
      expect(await balance(liveMain)).toBe(before);
      expect(h.pay).not.toHaveBeenCalled();
    });

    it("counts toward the daily outflow limit", async () => {
      h.pay.mockResolvedValue({ providerRef: "x", status: "successful" });
      await prisma.$executeRawUnsafe(`UPDATE dev_accounts SET daily_out_limit_ngn = 1 WHERE id = $1::uuid`, acct.id);
      invalidateKeyCache();
      const before = await balance(liveMain);
      const res = await pay({});
      expect(res.status).toBe(422);
      expect((await json(res)).error.code).toBe("limit_exceeded");
      expect(await balance(liveMain)).toBe(before);
      await prisma.$executeRawUnsafe(`UPDATE dev_accounts SET daily_out_limit_ngn = NULL WHERE id = $1::uuid`, acct.id);
      invalidateKeyCache();
    });

    it("parallel payments never overdraw the wallet, and the ledger still adds up", async () => {
      h.pay.mockImplementation(async (i: { reference: string }) => ({ providerRef: i.reference, status: "successful" }));
      // Leave room for exactly five ₦1,000 payments (plus fees).
      const per = 100_000n + feeOn(100_000n);
      const now = await balance(liveMain);
      const drain = now - per * 5n;
      await prisma.$transaction(async (db) => {
        const id = await insertTransaction(db, { accountId: acct.id, mode: "live", kind: "adjustment", status: "successful", currency: "NGN", amountMinor: drain, walletId: liveMain });
        await applyLegs(db, { accountId: acct.id, mode: "live" }, id, "NGN", [{ walletId: liveMain, amountMinor: -drain, kind: "adjustment" }]);
      });
      const results = await Promise.all(Array.from({ length: 12 }, () => pay({ amount: 100_000 })));
      const codes = results.map((r) => r.status);
      expect(codes.filter((c) => c === 201)).toHaveLength(5);
      expect(codes.filter((c) => c === 422)).toHaveLength(7);
      expect(await balance(liveMain)).toBe(0n);
      const mismatches = await findLedgerMismatches();
      expect(mismatches.filter((m) => m.account_id === acct.id)).toEqual([]);
    });
  });
});
