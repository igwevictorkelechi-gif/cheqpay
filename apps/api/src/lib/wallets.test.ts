import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  getFeatureFlags: vi.fn(),
  createDepositAddress: vi.fn(),
  getCustodyProvider: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD", BTC: "BTC", USDT: "USDT", USDC: "USDC" },
  Network: {
    FIAT: "FIAT",
    ETHEREUM: "ETHEREUM",
    BITCOIN: "BITCOIN",
    TRON: "TRON",
    BSC: "BSC",
    SOLANA: "SOLANA",
    BASE: "BASE",
    POLYGON: "POLYGON",
  },
  Prisma: { PrismaClientKnownRequestError: class {} },
  prisma: { wallet: { findMany: h.findMany, findUnique: h.findUnique, create: h.create } },
}));
vi.mock("@/custody", () => ({ getCustodyProvider: h.getCustodyProvider }));
vi.mock("./features", () => ({ getFeatureFlags: h.getFeatureFlags }));
vi.mock("./ensureNetworks", () => ({ ensureNetworks: vi.fn().mockResolvedValue(undefined) }));

import { listWallets, provisionWallets } from "./wallets";

describe("listWallets", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.findMany.mockResolvedValue([]);
  });

  it("excludes fiat virtual accounts — a NUBAN is not a deposit address", async () => {
    await listWallets("u1");
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", network: { not: "FIAT" } },
      }),
    );
  });
});

describe("provisionWallets", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.findMany.mockResolvedValue([]);
    h.findUnique.mockResolvedValue(null);
    h.create.mockResolvedValue({});
    h.getFeatureFlags.mockResolvedValue({ crypto_deposits: true });
    h.createDepositAddress.mockResolvedValue({ address: "0xabc", custodyRef: "ref" });
    h.getCustodyProvider.mockReturnValue({ createDepositAddress: h.createDepositAddress });
  });

  it("auto-provisions USDT and USDC on Solana — the withdrawable chain", async () => {
    await provisionWallets("u1");

    const minted = h.createDepositAddress.mock.calls.map((c) => `${c[0].asset}/${c[0].network}`);
    expect(minted).toEqual(["USDT/SOLANA", "USDC/SOLANA"]);
    expect(h.create).toHaveBeenCalledTimes(2);
  });

  it("mints a specific pair on demand (e.g. USDT on Base)", async () => {
    await provisionWallets("u1", [{ asset: "USDT" as never, network: "BASE" as never }]);

    const minted = h.createDepositAddress.mock.calls.map((c) => `${c[0].asset}/${c[0].network}`);
    expect(minted).toEqual(["USDT/BASE"]);
  });

  it("refuses a pair we cannot mint rather than calling the provider", async () => {
    await provisionWallets("u1", [{ asset: "BTC" as never, network: "BITCOIN" as never }]);
    expect(h.createDepositAddress).not.toHaveBeenCalled();
  });

  it("is idempotent — an existing wallet is not re-minted", async () => {
    h.findUnique.mockResolvedValue({ id: "w1" });
    await provisionWallets("u1");
    expect(h.createDepositAddress).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("mints nothing while crypto deposits are switched off", async () => {
    h.getFeatureFlags.mockResolvedValue({ crypto_deposits: false });
    await provisionWallets("u1");
    expect(h.createDepositAddress).not.toHaveBeenCalled();
  });

  it("survives a custody outage instead of failing the whole bootstrap", async () => {
    h.getCustodyProvider.mockImplementation(() => {
      throw new Error("custody down");
    });
    await expect(provisionWallets("u1")).resolves.toEqual([]);
  });

  it("keeps going when one asset fails to provision", async () => {
    h.createDepositAddress
      .mockRejectedValueOnce(new Error("provider hiccup"))
      .mockResolvedValueOnce({ address: "0xdef", custodyRef: "ref2" });

    await provisionWallets("u1");
    // The second asset still got written despite the first failing.
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});
