// Bills on vtu.ng against a real Postgres: buy → pending → settled by the
// signed webhook or by requery, with the refund paid exactly once. vtu.ng
// itself is replaced; the ledger, settlement and webhook route are real.
//
//   DEVAPI_DB_TESTS=1 DATABASE_URL=postgresql://… npx vitest run src/lib/vtungBills.int.test.ts

import { createHmac, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.BILLS_PROVIDER = "vtung";
process.env.VTU_NG_USERNAME = "u";
process.env.VTU_NG_PASSWORD = "p";
process.env.VTU_NG_PIN = "4321";

const vtu = vi.hoisted(() => ({
  pay: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/payments", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const fake = {
    name: "vtung",
    payBill: vtu.pay,
    queryBill: vtu.query,
    validateBillCustomer: async () => ({ valid: true }),
  };
  return { ...actual, getBillsProvider: () => fake, billsProviderNamed: () => fake, vtuNgIfConfigured: () => fake };
});
vi.mock("./alerts", () => ({ notifyUser: vi.fn(async () => ({})), alertOpsOnce: vi.fn(async () => undefined) }));

import { Asset, TransactionStatus, prisma } from "@cheqpay/db";
import { executeBillPayment } from "./billPay";
import { sweepVtuBills } from "./billReconcile";
import { POST as vtuWebhook } from "@/app/api/webhooks/vtung/route";

const RUN = process.env.DEVAPI_DB_TESTS === "1";

describe.skipIf(!RUN)("bills on vtu.ng", () => {
  let userId = "";
  const balance = async () =>
    (await prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId, asset: Asset.NGN } } })).available;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `vtu-${randomBytes(4).toString("hex")}@x.test`, kycTier: 2 } })).id;
    await prisma.balance.create({ data: { userId, asset: Asset.NGN, available: 1_000_000n } });
  });

  const buy = (key: string) =>
    executeBillPayment({
      userId,
      service: "airtime",
      billerId: "mtn",
      customer: "08030000000",
      amount: "100",
      idempotencyKey: key,
      initiatorIp: null,
    });

  const signed = (body: unknown) => {
    const raw = JSON.stringify(body);
    return new Request("http://x/api/webhooks/vtung", {
      method: "POST",
      body: raw,
      headers: { "x-signature": createHmac("sha256", "4321").update(raw).digest("hex"), "content-type": "application/json" },
    });
  };

  it("sends our transaction id as request_id and records the bill as a vtu.ng bill", async () => {
    vtu.pay.mockImplementationOnce(async (i: { reference: string; billerCode: string }) => {
      expect(i.billerCode).toBe("mtn");
      return { providerRef: i.reference, status: "pending" };
    });
    const r = await buy(`k-${randomBytes(4).toString("hex")}`);
    expect(r.status).toBe("processing");
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: r.transactionId } });
    expect(tx.externalRef).toBe(r.transactionId);
    expect((tx.metadata as Record<string, unknown>).billsProvider).toBe("vtung");
  });

  it("a signed webhook completes a pending bill once; a forged one is refused", async () => {
    vtu.pay.mockImplementationOnce(async (i: { reference: string }) => ({ providerRef: i.reference, status: "pending" }));
    const r = await buy(`k-${randomBytes(4).toString("hex")}`);

    const forged = signed({ request_id: r.transactionId, status: "completed-api" });
    forged.headers.set("x-signature", "0".repeat(64));
    expect((await vtuWebhook(forged)).status).toBe(401);

    const ok = await vtuWebhook(signed({ request_id: r.transactionId, status: "completed-api", token: "1234-5678" }));
    expect(await ok.json()).toMatchObject({ outcome: "completed" });
    const again = await vtuWebhook(signed({ request_id: r.transactionId, status: "completed-api", token: "1234-5678" }));
    expect(await again.json()).toMatchObject({ status: "duplicate" });

    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: r.transactionId } });
    expect(tx.status).toBe(TransactionStatus.COMPLETED);
    expect((tx.metadata as Record<string, unknown>).token).toBe("1234-5678");
  });

  it("a refunded order gives the money back exactly once, by webhook or requery", async () => {
    vtu.pay.mockImplementationOnce(async (i: { reference: string }) => ({ providerRef: i.reference, status: "pending" }));
    const before = await balance();
    const r = await buy(`k-${randomBytes(4).toString("hex")}`);
    expect(await balance()).toBeLessThan(before);

    // Old enough for the sweep, which asks vtu.ng and learns it was refunded.
    await prisma.transaction.update({ where: { id: r.transactionId }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    vtu.query.mockResolvedValue({ status: "failed", providerStatus: "refunded" });
    await sweepVtuBills({ olderThanMs: 60_000 });
    await vtuWebhook(signed({ request_id: r.transactionId, status: "refunded" })); // late webhook: no second refund

    expect(await balance()).toBe(before);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: r.transactionId } })).status).toBe(TransactionStatus.FAILED);
  });

  it("an explicit refusal refunds at once; a bill vtu.ng never saw is refunded only after 30 minutes", async () => {
    const { BillPaymentError } = await import("@/payments/types");
    vtu.pay.mockRejectedValueOnce(new BillPaymentError("refused", "Insufficient wallet balance", 400));
    const before = await balance();
    await expect(buy(`k-${randomBytes(4).toString("hex")}`)).rejects.toMatchObject({ code: "bill_error" });
    expect(await balance()).toBe(before);

    vtu.pay.mockImplementationOnce(async (i: { reference: string }) => ({ providerRef: i.reference, status: "pending" }));
    const r = await buy(`k-${randomBytes(4).toString("hex")}`);
    vtu.query.mockResolvedValue({ status: "not_found", providerStatus: null });
    await prisma.transaction.update({ where: { id: r.transactionId }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    await sweepVtuBills({ olderThanMs: 60_000 });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: r.transactionId } })).status).toBe(TransactionStatus.PROCESSING);
    await prisma.transaction.update({ where: { id: r.transactionId }, data: { createdAt: new Date(Date.now() - 40 * 60_000) } });
    await sweepVtuBills({ olderThanMs: 60_000 });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: r.transactionId } })).status).toBe(TransactionStatus.FAILED);
    expect(await balance()).toBe(before);
  });
});
