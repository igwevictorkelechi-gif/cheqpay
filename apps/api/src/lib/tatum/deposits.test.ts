import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  walletFindFirst: vi.fn(),
  creditBalance: vi.fn(),
  notifyUser: vi.fn(),
  ensureUsdAsset: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", BTC: "BTC", USDT: "USDT", USDC: "USDC", USD: "USD" },
  Network: {
    FIAT: "FIAT",
    BITCOIN: "BITCOIN",
    TRON: "TRON",
    BSC: "BSC",
    ETHEREUM: "ETHEREUM",
    SOLANA: "SOLANA",
    BASE: "BASE",
    POLYGON: "POLYGON",
  },
  TransactionType: { DEPOSIT: "DEPOSIT" },
  prisma: { wallet: { findFirst: h.walletFindFirst } },
}));
vi.mock("../ledger", () => ({ creditBalance: h.creditBalance }));
vi.mock("../alerts", () => ({ notifyUser: h.notifyUser }));
vi.mock("../ensureUsdAsset", () => ({ ensureUsdAsset: h.ensureUsdAsset }));

import {
  assetForDeposit,
  creditedAssetFor,
  creditTatumDeposit,
  networkForChain,
  parseTatumDeposit,
  wholeToMinor,
  type ParsedTatumDeposit,
} from "./deposits";

const USDT_BSC = "0x55d398326f99059ff775485246999027b3197955";
const ADDRESS = "0xAbC0000000000000000000000000000000000001";

function deposit(overrides: Partial<ParsedTatumDeposit> = {}): ParsedTatumDeposit {
  return {
    address: ADDRESS,
    network: "BSC" as ParsedTatumDeposit["network"],
    amount: "25",
    type: "token",
    contract: USDT_BSC,
    txId: "0xtx1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.walletFindFirst.mockResolvedValue({ userId: "u1" });
  h.creditBalance.mockResolvedValue({ created: true, transactionId: "t1" });
  h.notifyUser.mockResolvedValue(undefined);
  h.ensureUsdAsset.mockResolvedValue(undefined);
});

describe("networkForChain", () => {
  it("maps Tatum chain strings onto our networks", () => {
    expect(networkForChain("bsc-mainnet")).toBe("BSC");
    expect(networkForChain("BSC-MAINNET")).toBe("BSC");
    expect(networkForChain("ethereum-mainnet")).toBe("ETHEREUM");
    expect(networkForChain("tron-mainnet")).toBe("TRON");
    expect(networkForChain("bitcoin-mainnet")).toBe("BITCOIN");
    expect(networkForChain("polygon-mainnet")).toBe("POLYGON");
  });

  it("returns null for chains we do not carry", () => {
    // opBNB is a different chain from BNB Smart Chain: crediting it as BSC
    // would credit balance for funds that never reached a BSC address.
    expect(networkForChain("opbnb-mainnet")).toBeNull();
    expect(networkForChain("solana-mainnet")).toBeNull();
    expect(networkForChain("")).toBeNull();
  });
});

describe("parseTatumDeposit", () => {
  it("reads a flat ADDRESS_EVENT payload", () => {
    const d = parseTatumDeposit({
      address: ADDRESS,
      amount: "12.5",
      currency: "USDT",
      chain: "bsc-mainnet",
      type: "token",
      contractAddress: USDT_BSC.toUpperCase(),
      txId: "0xdeadbeef",
    });
    expect(d).toMatchObject({
      address: ADDRESS,
      network: "BSC",
      amount: "12.5",
      type: "token",
      contract: USDT_BSC, // lowercased for comparison
      txId: "0xdeadbeef",
    });
  });

  it("reads a payload nested under data", () => {
    const d = parseTatumDeposit({
      data: { address: ADDRESS, amount: "1", chain: "bsc-mainnet", txId: "0xa" },
    });
    expect(d?.network).toBe("BSC");
    expect(d?.type).toBe("native"); // absent type defaults to native
  });

  it("returns null when a required field is missing", () => {
    const full = { address: ADDRESS, amount: "1", chain: "bsc-mainnet", txId: "0xa" };
    for (const key of Object.keys(full)) {
      const partial = { ...full } as Record<string, unknown>;
      delete partial[key];
      expect(parseTatumDeposit(partial)).toBeNull();
    }
    expect(parseTatumDeposit(null)).toBeNull();
    expect(parseTatumDeposit("nonsense")).toBeNull();
  });

  it("returns null for a chain we do not carry", () => {
    expect(
      parseTatumDeposit({ address: ADDRESS, amount: "1", chain: "opbnb-mainnet", txId: "0xa" }),
    ).toBeNull();
  });
});

describe("wholeToMinor", () => {
  it("reads Tatum amounts as whole units, not minor units", () => {
    // The factor-of-a-million bug this guards: "1" is 1 USDT, not 0.000001.
    expect(wholeToMinor("1", "USDT" as never)).toBe(1_000_000n);
    expect(wholeToMinor("25", "USDT" as never)).toBe(25_000_000n);
    expect(wholeToMinor("12.5", "USDC" as never)).toBe(12_500_000n);
    expect(wholeToMinor("0.000001", "USDT" as never)).toBe(1n);
    expect(wholeToMinor("0.001", "BTC" as never)).toBe(100_000n);
    expect(wholeToMinor("1.23456789", "BTC" as never)).toBe(123_456_789n);
  });

  it("truncates precision the ledger cannot hold", () => {
    // BEP-20 carries 18 decimals; our USDT ledger holds 6.
    expect(wholeToMinor("1.0000001", "USDT" as never)).toBe(1_000_000n);
    expect(wholeToMinor("1.9999999", "USDT" as never)).toBe(1_999_999n);
    expect(wholeToMinor("0.0000009", "USDT" as never)).toBe(0n);
  });

  it("rejects anything that is not a plain positive decimal", () => {
    for (const bad of ["", "-1", "1e6", "abc", "1.2.3", "0x1", " 1,5 ", "NaN", "Infinity"]) {
      expect(wholeToMinor(bad, "USDT" as never)).toBeNull();
    }
  });
});

describe("assetForDeposit", () => {
  it("credits official token contracts", () => {
    expect(assetForDeposit(deposit())).toBe("USDT");
    expect(
      assetForDeposit(deposit({ contract: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" })),
    ).toBe("USDC");
    expect(
      assetForDeposit(
        deposit({
          network: "ETHEREUM" as ParsedTatumDeposit["network"],
          contract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
        }),
      ),
    ).toBe("USDT");
    expect(
      assetForDeposit(
        deposit({
          network: "TRON" as ParsedTatumDeposit["network"],
          contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t".toLowerCase(),
        }),
      ),
    ).toBe("USDT");
  });

  it("refuses a counterfeit token that calls itself USDT", () => {
    // Anyone can deploy a token named USDT on BSC and send it for free.
    // Crediting on the symbol would mint real balance from a worthless token.
    expect(
      assetForDeposit(
        deposit({ contract: "0x000000000000000000000000000000000000dead", asset: "USDT" }),
      ),
    ).toBeNull();
    expect(assetForDeposit(deposit({ contract: undefined, asset: "USDT" }))).toBeNull();
  });

  it("refuses a real contract arriving on the wrong chain", () => {
    // The Ethereum USDT contract address is meaningless on BSC.
    expect(
      assetForDeposit(deposit({ contract: "0xdac17f958d2ee523a2206206994597c13d831ec7" })),
    ).toBeNull();
  });

  it("credits native coins only where we carry a balance", () => {
    expect(
      assetForDeposit(
        deposit({ network: "BITCOIN" as ParsedTatumDeposit["network"], type: "native", contract: undefined }),
      ),
    ).toBe("BTC");
    // We hold no BNB/ETH/MATIC balance, so a native arrival there is not a credit.
    expect(assetForDeposit(deposit({ type: "native", contract: undefined }))).toBeNull();
  });

  it("never credits NFTs or internal transfers", () => {
    for (const type of ["erc721", "erc1155", "internal", "fee"]) {
      expect(assetForDeposit(deposit({ type, contract: undefined }))).toBeNull();
    }
  });
});

describe("creditedAssetFor", () => {
  it("lands stablecoins as dollars on chains we cannot send from", () => {
    // Crediting USDT on BSC would give the user a balance they can never
    // withdraw. The Maplerad path applies the same rule; the two must agree,
    // or the asset would depend on which provider minted the address.
    expect(creditedAssetFor(deposit())).toBe("USD");
    expect(
      assetForDeposit(deposit()),
    ).toBe("USDT"); // the coin sent is still known, for the ledger metadata
    expect(
      creditedAssetFor(
        deposit({
          network: "TRON" as ParsedTatumDeposit["network"],
          contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t".toLowerCase(),
        }),
      ),
    ).toBe("USD");
  });

  it("leaves a native coin as itself", () => {
    // BTC is not a stablecoin standing in for dollars, so it lands as BTC.
    expect(
      creditedAssetFor(
        deposit({
          network: "BITCOIN" as ParsedTatumDeposit["network"],
          type: "native",
          contract: undefined,
        }),
      ),
    ).toBe("BTC");
  });

  it("stays null for anything not creditable", () => {
    expect(creditedAssetFor(deposit({ contract: "0xdead", asset: "USDT" }))).toBeNull();
  });
});

describe("creditTatumDeposit", () => {
  it("credits the address owner and notifies them", async () => {
    const res = await creditTatumDeposit(deposit());

    expect(res).toMatchObject({ outcome: "credited", userId: "u1", transactionId: "t1" });
    expect(h.creditBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        // Dollars, not USDT: BSC is not a chain we can send from.
        asset: "USD",
        amountMinor: 25_00n,
        type: "DEPOSIT",
        network: "BSC",
        txHash: "0xtx1",
      }),
    );
    expect(h.notifyUser).toHaveBeenCalledTimes(1);
  });

  it("keys idempotency on transaction + address + amount", async () => {
    await creditTatumDeposit(deposit());
    expect(h.creditBalance.mock.calls[0][0].idempotencyKey).toBe(
      `deposit:tatum:0xtx1:${ADDRESS.toLowerCase()}:25`,
    );

    // One transaction can pay two of our addresses: those stay distinct.
    await creditTatumDeposit(deposit({ address: "0xOther" }));
    expect(h.creditBalance.mock.calls[1][0].idempotencyKey).toBe(
      "deposit:tatum:0xtx1:0xother:25",
    );
  });

  it("reports a redelivered notification as a duplicate and stays quiet", async () => {
    h.creditBalance.mockResolvedValue({ created: false, transactionId: "t1" });

    const res = await creditTatumDeposit(deposit());

    expect(res).toMatchObject({ outcome: "duplicate", transactionId: "t1" });
    expect(h.notifyUser).not.toHaveBeenCalled();
  });

  it("never credits an address we did not derive", async () => {
    h.walletFindFirst.mockResolvedValue(null);

    const res = await creditTatumDeposit(deposit());

    expect(res.outcome).toBe("unmatched");
    expect(h.creditBalance).not.toHaveBeenCalled();
  });

  it("does not touch the ledger for an unrecognised token", async () => {
    const res = await creditTatumDeposit(
      deposit({ contract: "0x000000000000000000000000000000000000dead", asset: "USDT" }),
    );

    expect(res.outcome).toBe("ignored");
    expect(h.walletFindFirst).not.toHaveBeenCalled();
    expect(h.creditBalance).not.toHaveBeenCalled();
  });

  it("records the coin actually sent alongside the dollars credited", async () => {
    await creditTatumDeposit(deposit());
    expect(h.creditBalance.mock.calls[0][0].metadata).toMatchObject({
      source: "tatum",
      coin: "USDT",
      offramp: true,
    });
  });

  it("does not credit an unreadable amount", async () => {
    for (const amount of ["not-a-number", "1e6", "-5"]) {
      h.creditBalance.mockClear();
      const res = await creditTatumDeposit(deposit({ amount }));
      expect(res.outcome).toBe("unmatched");
      expect(h.creditBalance).not.toHaveBeenCalled();
    }
  });

  it("ignores dust below the ledger's precision instead of paging a human", async () => {
    // Credited as dollars, "0.001" USDT is a tenth of a cent: nothing to
    // credit, and nothing for a human to place either.
    for (const amount of ["0", "0.001"]) {
      h.creditBalance.mockClear();
      const res = await creditTatumDeposit(deposit({ amount }));
      expect(res.outcome).toBe("ignored");
      expect(h.creditBalance).not.toHaveBeenCalled();
    }
  });

  it("still reports the credit when the push notification fails", async () => {
    h.notifyUser.mockRejectedValue(new Error("push down"));

    await expect(creditTatumDeposit(deposit())).resolves.toMatchObject({ outcome: "credited" });
  });
});
