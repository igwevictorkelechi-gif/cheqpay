import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  walletFindFirst: vi.fn(),
  creditBalance: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD", BTC: "BTC", USDT: "USDT", USDC: "USDC" },
  Network: { FIAT: "FIAT", SOLANA: "SOLANA", ETHEREUM: "ETHEREUM" },
  TransactionType: { DEPOSIT: "DEPOSIT" },
  prisma: { wallet: { findFirst: h.walletFindFirst } },
}));
vi.mock("../ledger", () => ({ creditBalance: h.creditBalance }));
vi.mock("../alerts", () => ({ notifyUser: h.notifyUser }));

import {
  assetForCoin,
  creditCryptoDeposit,
  parseCryptoDeposit,
  toMinor,
} from "./cryptoDeposits";

describe("parseCryptoDeposit", () => {
  it("reads the documented shape", () => {
    const p = parseCryptoDeposit({
      event: "crypto.deposit.successful",
      data: {
        id: "dep-1",
        address: "BvH5k",
        coin: "usdc",
        amount: 1000,
        chain: "solana",
        status: "SUCCESS",
      },
    });
    expect(p).toMatchObject({
      address: "BvH5k",
      coin: "usdc",
      rawAmount: "1000",
      chain: "solana",
      providerTxId: "dep-1",
      status: "SUCCESS",
    });
  });

  it("reads alternative key names and a nested body", () => {
    const p = parseCryptoDeposit({
      data: { transaction: { to_address: "0xabc", currency: "USDT", value: "12.5", hash: "0xdead" } },
    });
    expect(p).toMatchObject({ address: "0xabc", coin: "USDT", rawAmount: "12.5", providerTxId: "0xdead" });
  });

  it("treats a missing status as settled", () => {
    const p = parseCryptoDeposit({ data: { id: "d", address: "a", coin: "usdc", amount: 5 } });
    expect(p?.status).toBe("SUCCESS");
  });

  it("returns null when a field crediting needs is missing", () => {
    // No address — we would not know whose money this is.
    expect(parseCryptoDeposit({ data: { id: "d", coin: "usdc", amount: 5 } })).toBeNull();
    // No amount.
    expect(parseCryptoDeposit({ data: { id: "d", address: "a", coin: "usdc" } })).toBeNull();
  });
});

describe("toMinor", () => {
  it("reads a decimal as whole units", () => {
    expect(toMinor("12.5", "USDC" as never)).toBe(12_500_000n); // 6dp
    expect(toMinor("1.234567", "USDT" as never)).toBe(1_234_567n);
  });

  it("reads a bare integer as minor units, matching the rest of the API", () => {
    expect(toMinor("1000", "USDC" as never)).toBe(1000n);
  });

  it("refuses anything it cannot read exactly", () => {
    for (const bad of ["", "abc", "-5", "1e6", "1.2.3"]) {
      expect(toMinor(bad, "USDC" as never)).toBeNull();
    }
  });
});

describe("assetForCoin", () => {
  it("maps the coins we carry, case-insensitively", () => {
    expect(assetForCoin("usdc")).toBe("USDC");
    expect(assetForCoin("USDT")).toBe("USDT");
    expect(assetForCoin("USD")).toBe("USD");
  });
  it("refuses a coin we do not carry", () => {
    expect(assetForCoin("PYUSD")).toBeNull();
    expect(assetForCoin("DOGE")).toBeNull();
  });
});

describe("creditCryptoDeposit", () => {
  const deposit = {
    address: "BvH5k",
    coin: "usdc",
    rawAmount: "5000000",
    chain: "solana",
    providerTxId: "dep-1",
    status: "SUCCESS",
    offramp: false,
  };

  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.walletFindFirst.mockResolvedValue({ userId: "u1", asset: "USDC", network: "SOLANA" });
    h.creditBalance.mockResolvedValue({ created: true, transactionId: "tx-1" });
    h.notifyUser.mockResolvedValue(undefined);
  });

  it("credits the address owner, keyed on the provider tx id", async () => {
    const r = await creditCryptoDeposit(deposit);
    expect(r).toMatchObject({ outcome: "credited", userId: "u1", transactionId: "tx-1" });
    expect(h.creditBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        asset: "USDC",
        amountMinor: 5_000_000n,
        idempotencyKey: "deposit:maplerad:crypto:dep-1",
      }),
    );
  });

  it("credits USD when the provider offramped the arrival", async () => {
    await creditCryptoDeposit({ ...deposit, offramp: true, rawAmount: "2500" });
    expect(h.creditBalance).toHaveBeenCalledWith(
      expect.objectContaining({ asset: "USD", amountMinor: 2500n }),
    );
  });

  it("leaves an unknown address unmatched instead of crediting a guess", async () => {
    h.walletFindFirst.mockResolvedValue(null);
    const r = await creditCryptoDeposit(deposit);
    expect(r.outcome).toBe("unmatched");
    expect(h.creditBalance).not.toHaveBeenCalled();
  });

  it("ignores a deposit that has not settled", async () => {
    const r = await creditCryptoDeposit({ ...deposit, status: "PENDING" });
    expect(r.outcome).toBe("ignored");
    expect(h.creditBalance).not.toHaveBeenCalled();
  });

  it("reports a replay as a duplicate and does not re-notify", async () => {
    h.creditBalance.mockResolvedValue({ created: false, transactionId: "tx-1" });
    const r = await creditCryptoDeposit(deposit);
    expect(r.outcome).toBe("duplicate");
    expect(h.notifyUser).not.toHaveBeenCalled();
  });

  it("refuses an amount it cannot read rather than crediting zero", async () => {
    const r = await creditCryptoDeposit({ ...deposit, rawAmount: "not-a-number" });
    expect(r.outcome).toBe("unmatched");
    expect(h.creditBalance).not.toHaveBeenCalled();
  });
});
