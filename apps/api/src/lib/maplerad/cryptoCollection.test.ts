import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  txFindFirst: vi.fn(),
  walletFindMany: vi.fn(),
  creditBalance: vi.fn(),
  notifyUser: vi.fn(),
  ensureUsdAsset: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD", BTC: "BTC", USDT: "USDT", USDC: "USDC" },
  Network: {
    FIAT: "FIAT", SOLANA: "SOLANA", ETHEREUM: "ETHEREUM", BASE: "BASE",
    POLYGON: "POLYGON", TRON: "TRON", BSC: "BSC", BITCOIN: "BITCOIN",
  },
  TransactionType: { DEPOSIT: "DEPOSIT" },
  prisma: {
    user: { findFirst: h.userFindFirst },
    transaction: { findFirst: h.txFindFirst },
    wallet: { findMany: h.walletFindMany },
  },
}));
vi.mock("../ledger", () => ({ creditBalance: h.creditBalance }));
vi.mock("../alerts", () => ({ notifyUser: h.notifyUser }));
vi.mock("../ensureUsdAsset", () => ({ ensureUsdAsset: h.ensureUsdAsset }));
vi.mock("../settings", async () => {
  const actual = await vi.importActual<typeof import("../settings")>("../settings");
  return { getPricing: async () => actual.PRICING_DEFAULTS };
});

import {
  coinFor,
  creditCryptoCollection,
  isCryptoCollection,
  networkFor,
  toAssetMinor,
} from "./cryptoCollection";
import type { VerifiedTransaction } from "./transactions";

/** The live payload, copied from the production verify response. */
function live(over: Partial<VerifiedTransaction> = {}): VerifiedTransaction {
  return {
    id: "19cb3252-7665-40e3-8aff-6e29fd8db9aa",
    status: "SUCCESS",
    entry: "CREDIT",
    type: "COLLECTION",
    amount: 1000,
    fee: 0,
    currency: "USDT",
    channel: "CRYPTO",
    summary: "USDT Deposit | BSC | 0xEB2d2F1b8c558a40207669291Fda468E50c8A0bB",
    reference: "0x9ef258b34f59980a3422acf61978e26247f49ab06600448064f8252edc63ef51",
    account_id: null,
    customer: { id: "678f9b4a-5120-4cfd-bcc4-e73cdd9995ce", name: "Clinton Tata" },
    source: { bank_name: "BSC", account_number: "0xEB2d2F1b8c558a40207669291Fda468E50c8A0bB" },
    ...over,
  } as VerifiedTransaction;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.userFindFirst.mockResolvedValue({ id: "user-1" });
  h.txFindFirst.mockResolvedValue(null);
  h.walletFindMany.mockResolvedValue([]);
  h.creditBalance.mockResolvedValue({ created: true, transactionId: "led-1" });
  h.notifyUser.mockResolvedValue({ devices: 0, email: false });
  h.ensureUsdAsset.mockResolvedValue(undefined);
});

describe("shape helpers", () => {
  it("recognises the live deposit as a crypto collection", () => {
    expect(isCryptoCollection(live())).toBe(true);
    expect(isCryptoCollection(live({ channel: "BANKTRANSFER", currency: "NGN" }))).toBe(false);
  });
  it("maps coins and chains from the provider's wording", () => {
    expect(coinFor("USDT")).toBe("USDT");
    expect(coinFor("usdc")).toBe("USDC");
    expect(coinFor("NGN")).toBeNull();
    expect(networkFor("BSC")).toBe("BSC");
    expect(networkFor("BEP20")).toBe("BSC");
    expect(networkFor("Solana")).toBe("SOLANA");
    expect(networkFor("TRC20")).toBe("TRON");
    expect(networkFor("")).toBeNull();
  });
});

describe("toAssetMinor", () => {
  it("treats the provider amount as 2dp and scales to the asset", () => {
    // 1000 provider minor = $10.00 -> USD is also 2dp, so unchanged.
    expect(toAssetMinor(1000, "USD" as never)).toBe(1000n);
    // The same 10.00 as USDT at 6dp is 10_000_000.
    expect(toAssetMinor(1000, "USDT" as never)).toBe(10_000_000n);
  });
  it("refuses a non-positive or fractional amount rather than rounding", () => {
    expect(toAssetMinor(0, "USD" as never)).toBeNull();
    expect(toAssetMinor(-5, "USD" as never)).toBeNull();
    expect(toAssetMinor(1.5, "USD" as never)).toBeNull();
  });
});

describe("creditCryptoCollection", () => {
  it("credits the live BSC USDT deposit as USD 10.00, because BSC cannot be withdrawn from", async () => {
    const res = await creditCryptoCollection(live());
    expect(res).toMatchObject({ outcome: "credited", userId: "user-1" });
    expect(h.creditBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        asset: "USD",
        amountMinor: 1000n, // $10.00
        // Our 1% conversion fee: Maplerad keeps its ramp cut from our wallet,
        // so crediting the full amount lost money on every deposit.
        feeMinor: 10n,
        network: "BSC",
        idempotencyKey: "deposit:maplerad:19cb3252-7665-40e3-8aff-6e29fd8db9aa",
        txHash: "0x9ef258b34f59980a3422acf61978e26247f49ab06600448064f8252edc63ef51",
      }),
    );
    expect(h.ensureUsdAsset).toHaveBeenCalled();
  });

  it("credits the coin itself on a chain we CAN withdraw from", async () => {
    const res = await creditCryptoCollection(
      live({ source: { bank_name: "SOLANA", account_number: "abc" }, summary: "USDT Deposit | SOLANA" }),
    );
    expect(res.outcome).toBe("credited");
    expect(h.creditBalance).toHaveBeenCalledWith(
      expect.objectContaining({ asset: "USDT", amountMinor: 10_000_000n, feeMinor: 0n, network: "SOLANA" }),
    );
  });

  it("tells the user the conversion fee on an offramped deposit", async () => {
    await creditCryptoCollection(live({ amount: 16099 }));
    expect(h.creditBalance).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 16099n, feeMinor: 160n }));
    expect(h.notifyUser.mock.calls[0][1].body).toContain("$159.39 added to your balance ($1.60 conversion fee)");
  });

  it("finds the owner by customer id, since account_id is null", async () => {
    await creditCryptoCollection(live());
    expect(h.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mapleradCustomerId: "678f9b4a-5120-4cfd-bcc4-e73cdd9995ce" },
      }),
    );
  });

  it("will not credit twice — checks the collection key AND both crypto keys", async () => {
    h.txFindFirst.mockResolvedValue({ id: "already" });
    const res = await creditCryptoCollection(live());
    expect(res.outcome).toBe("duplicate");
    expect(h.creditBalance).not.toHaveBeenCalled();
    const keys = h.txFindFirst.mock.calls[0][0].where.idempotencyKey.in;
    expect(keys).toContain("deposit:maplerad:19cb3252-7665-40e3-8aff-6e29fd8db9aa");
    expect(keys).toContain("deposit:maplerad:crypto:19cb3252-7665-40e3-8aff-6e29fd8db9aa");
    expect(keys).toContain(
      "deposit:maplerad:crypto:0x9ef258b34f59980a3422acf61978e26247f49ab06600448064f8252edc63ef51",
    );
  });

  it("falls back to the user's own address when the chain is not stated", async () => {
    h.walletFindMany.mockResolvedValue([{ network: "SOLANA" }]);
    const res = await creditCryptoCollection(
      live({ source: { bank_name: "", account_number: "" }, summary: "USDT Deposit" }),
    );
    expect(res.outcome).toBe("credited");
    expect(h.creditBalance).toHaveBeenCalledWith(expect.objectContaining({ network: "SOLANA" }));
  });

  it("refuses to guess when the user holds that coin on more than one chain", async () => {
    h.walletFindMany.mockResolvedValue([{ network: "SOLANA" }, { network: "BSC" }]);
    const res = await creditCryptoCollection(
      live({ source: { bank_name: "", account_number: "" }, summary: "USDT Deposit" }),
    );
    expect(res).toMatchObject({ outcome: "unmatched" });
    expect(h.creditBalance).not.toHaveBeenCalled();
  });

  it("leaves an unknown customer for a human rather than crediting a guess", async () => {
    h.userFindFirst.mockResolvedValue(null);
    const res = await creditCryptoCollection(live());
    expect(res.outcome).toBe("unmatched");
    expect(h.creditBalance).not.toHaveBeenCalled();
  });
});
