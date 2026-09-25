import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NGN withdrawal fees. With `feeInclusive` (what both apps send) the fee comes
 * out of the typed amount: the balance drops by exactly that amount and the bank
 * receives the rest, so "Max" — the whole balance — always goes through.
 */

const h = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  txFindUnique: vi.fn(),
  txCreate: vi.fn(),
  txUpdate: vi.fn(),
  balanceUpdateMany: vi.fn(),
  balanceUpdate: vi.fn(),
  auditCreate: vi.fn(),
  initiateTransfer: vi.fn(),
  fee: vi.fn(),
  min: vi.fn(),
  assertWithdrawalAllowed: vi.fn(),
}));

const db = {
  balance: { updateMany: h.balanceUpdateMany },
  transaction: { create: h.txCreate },
};

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN" },
  TransactionStatus: { PROCESSING: "PROCESSING", FAILED: "FAILED" },
  TransactionType: { WITHDRAWAL: "WITHDRAWAL" },
  prisma: {
    user: { findUnique: h.userFindUnique },
    transaction: { findUnique: h.txFindUnique, update: h.txUpdate },
    balance: { update: h.balanceUpdate },
    auditLog: { create: h.auditCreate },
    $transaction: (arg: unknown) =>
      typeof arg === "function" ? (arg as (d: typeof db) => unknown)(db) : Promise.all(arg as unknown[]),
  },
}));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "u1" }) }));
vi.mock("@/lib/features", () => ({ assertFeatureEnabled: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/transactionPin", () => ({ readPin: vi.fn(), requireTransactionPin: vi.fn() }));
vi.mock("@/lib/requestContext", () => ({ requestContext: () => ({ ip: "1.2.3.4" }) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/limits", () => ({
  assertWithdrawalAllowed: h.assertWithdrawalAllowed,
  sumTodayWithdrawalsNgnKobo: vi.fn().mockResolvedValue(0n),
}));
vi.mock("@/lib/settings", () => ({ getWithdrawalFeeNgn: h.fee, getWithdrawalMinNgn: h.min }));
vi.mock("@/payments", () => ({ getPaymentProvider: () => ({ initiateTransfer: h.initiateTransfer }) }));

import { POST } from "./route";

function withdraw(body: Record<string, unknown>) {
  return POST(
    new Request("https://api/x", {
      method: "POST",
      headers: { "idempotency-key": "k1", "content-type": "application/json" },
      body: JSON.stringify({ bankCode: "058", accountNumber: "0123456789", ...body }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.userFindUnique.mockResolvedValue({ id: "u1", kycTier: 2 });
  h.txFindUnique.mockResolvedValue(null);
  h.balanceUpdateMany.mockResolvedValue({ count: 1 });
  h.txCreate.mockResolvedValue({ id: "tx1" });
  h.initiateTransfer.mockResolvedValue({ providerRef: "pr1" });
  h.fee.mockResolvedValue(200);
  h.min.mockResolvedValue(0);
});

describe("feeInclusive (what the apps send)", () => {
  it("debits exactly the typed amount and pays out the rest", async () => {
    const res = await withdraw({ amount: "100000", feeInclusive: true });
    expect(res.status).toBe(200);

    // Balance drops by ₦100,000 — not ₦100,200.
    expect(h.balanceUpdateMany.mock.calls[0][0].data.available.decrement).toBe(10_000_000n);
    // The bank is sent ₦99,800.
    expect(h.initiateTransfer.mock.calls[0][0].amount).toBe("99800.00");
    // The row keeps its meaning: amount = what the bank receives, fee = fee.
    expect(h.txCreate.mock.calls[0][0].data).toMatchObject({ amount: 9_980_000n, fee: 20_000n });

    const body = await res.json();
    expect(body).toMatchObject({ amount: "100000.00", fee: "200.00", youReceive: "99800.00" });
  });

  it("applies the daily limit to what reaches the bank", async () => {
    await withdraw({ amount: "100000", feeInclusive: true });
    expect(h.assertWithdrawalAllowed.mock.calls[0][1]).toBe(9_980_000n);
  });

  it("refuses an amount the fee would swallow, before touching the balance", async () => {
    const res = await withdraw({ amount: "200", feeInclusive: true });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("below_fee");
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
  });

  it("with no fee set, pays out the whole amount", async () => {
    h.fee.mockResolvedValue(0);
    await withdraw({ amount: "5000", feeInclusive: true });
    expect(h.initiateTransfer.mock.calls[0][0].amount).toBe("5000.00");
    expect(h.balanceUpdateMany.mock.calls[0][0].data.available.decrement).toBe(500_000n);
  });

  it("refunds the whole typed amount if the payout can't be sent", async () => {
    h.initiateTransfer.mockRejectedValue(new Error("provider down"));
    const res = await withdraw({ amount: "100000", feeInclusive: true });
    expect(res.status).toBe(502);
    expect(h.balanceUpdate.mock.calls[0][0].data.available.increment).toBe(10_000_000n);
  });
});

describe("without feeInclusive (older clients)", () => {
  it("keeps the old behaviour: the bank gets the amount and the fee is on top", async () => {
    await withdraw({ amount: "100000" });
    expect(h.initiateTransfer.mock.calls[0][0].amount).toBe("100000.00");
    expect(h.balanceUpdateMany.mock.calls[0][0].data.available.decrement).toBe(10_020_000n);
  });
});
