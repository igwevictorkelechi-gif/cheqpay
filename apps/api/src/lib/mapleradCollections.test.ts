import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  walletFindFirst,
  userFindFirst,
  txFindUnique,
  auditCreate,
  creditBalance,
  awardCashback,
  notifyUser,
  getDepositFeeBps,
  ensureUsdAsset,
} = vi.hoisted(() => ({
  walletFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  txFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  creditBalance: vi.fn(),
  awardCashback: vi.fn(),
  notifyUser: vi.fn(),
  getDepositFeeBps: vi.fn(),
  ensureUsdAsset: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD" },
  Network: { FIAT: "FIAT" },
  TransactionType: { DEPOSIT: "DEPOSIT" },
  prisma: {
    wallet: { findFirst: walletFindFirst },
    user: { findFirst: userFindFirst },
    transaction: { findUnique: txFindUnique },
    auditLog: { create: auditCreate },
  },
}));
vi.mock("./ledger", () => ({ creditBalance }));
vi.mock("./cashback", () => ({ awardCashback }));
vi.mock("./alerts", () => ({ notifyUser }));
vi.mock("./settings", () => ({
  getDepositFeeBps,
  feeFromBps: (amount: bigint, bps: number) => (amount * BigInt(bps)) / 10000n,
}));
vi.mock("./ensureUsdAsset", () => ({ ensureUsdAsset }));

import { prismaLedgerPort } from "./mapleradCollections";

describe("prismaLedgerPort — currency-aware crediting", () => {
  beforeEach(() => {
    walletFindFirst.mockReset().mockResolvedValue({ userId: "u1" });
    userFindFirst.mockReset().mockResolvedValue(null);
    txFindUnique.mockReset().mockResolvedValue(null);
    auditCreate.mockReset().mockResolvedValue({});
    creditBalance.mockReset().mockResolvedValue({ created: true, transactionId: "t1" });
    awardCashback.mockReset().mockResolvedValue(undefined);
    notifyUser.mockReset().mockResolvedValue(undefined);
    getDepositFeeBps.mockReset().mockResolvedValue(0);
    ensureUsdAsset.mockReset().mockResolvedValue(undefined);
  });

  it("matches a USD deposit against the USD wallet, not the NGN one", async () => {
    await prismaLedgerPort.findUserByAccount({ accountNumber: "83001", currency: "USD" });
    expect(walletFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ asset: "USD", address: "83001" }) }),
    );
  });

  it("refuses to match an unknown currency", async () => {
    const r = await prismaLedgerPort.findUserByAccount({ accountNumber: "1", currency: "EUR" });
    expect(r).toBeNull();
    expect(walletFindFirst).not.toHaveBeenCalled();
  });

  it("treats a missing currency as NGN (backward compatible)", async () => {
    await prismaLedgerPort.findUserByAccount({ accountNumber: "0123456789" });
    expect(walletFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ asset: "NGN" }) }),
    );
  });

  it("credits USD to the USD balance and pays no NGN cashback", async () => {
    await prismaLedgerPort.creditUser({
      userId: "u1",
      amountMinor: 5000,
      currency: "USD",
      providerTxId: "tx-usd",
      raw: {} as never,
    });

    expect(ensureUsdAsset).toHaveBeenCalled();
    expect(creditBalance).toHaveBeenCalledWith(expect.objectContaining({ asset: "USD" }));
    expect(awardCashback).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "usd.deposit.credited" }) }),
    );
    // The user is told in dollars.
    expect(notifyUser).toHaveBeenCalledWith("u1", expect.objectContaining({ body: expect.stringContaining("$") }));
  });

  it("still credits NGN with cashback, unchanged", async () => {
    await prismaLedgerPort.creditUser({
      userId: "u1",
      amountMinor: 100000,
      currency: "NGN",
      providerTxId: "tx-ngn",
      raw: {} as never,
    });

    expect(creditBalance).toHaveBeenCalledWith(expect.objectContaining({ asset: "NGN" }));
    expect(awardCashback).toHaveBeenCalled();
    expect(ensureUsdAsset).not.toHaveBeenCalled();
    expect(notifyUser).toHaveBeenCalledWith("u1", expect.objectContaining({ body: expect.stringContaining("₦") }));
  });

  it("does not re-notify or pay cashback on a webhook retry (credit already existed)", async () => {
    creditBalance.mockResolvedValue({ created: false, transactionId: "t1" });
    await prismaLedgerPort.creditUser({
      userId: "u1",
      amountMinor: 100000,
      currency: "NGN",
      providerTxId: "tx-ngn",
      raw: {} as never,
    });
    expect(awardCashback).not.toHaveBeenCalled();
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
