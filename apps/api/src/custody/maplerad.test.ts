import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapleradCustodyProvider unit tests. The provider hangs addresses off the
 * user's stored Maplerad customer id and maps Asset/Network onto Maplerad's
 * coin/chain names; both mappings are money-critical.
 */

const findUnique = vi.fn();
vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", BTC: "BTC", USDT: "USDT", USDC: "USDC" },
  Network: { FIAT: "FIAT", BITCOIN: "BITCOIN", TRON: "TRON", BSC: "BSC", ETHEREUM: "ETHEREUM" },
  prisma: { user: { findUnique } },
}));

function stubFetch(response: unknown, status = 200) {
  const sent: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ status: true, data: response }), { status });
  });
  return sent;
}

async function makeProvider() {
  // lib/maplerad/client.ts reads MAPLERAD_SECRET_KEY at module load.
  process.env.MAPLERAD_SECRET_KEY = "sk-test";
  vi.resetModules();
  const { MapleradCustodyProvider } = await import("./maplerad");
  return new MapleradCustodyProvider();
}

beforeEach(() => {
  findUnique.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MapleradCustodyProvider", () => {
  it("mints a USDT ERC-20 address against the user's Maplerad customer", async () => {
    findUnique.mockResolvedValue({ mapleradCustomerId: "cust-1" });
    const sent = stubFetch({ id: "addr-1", address: "0xabc", chain: "eth", coin: "USDT" });
    const psp = await makeProvider();

    const a = await psp.createDepositAddress({
      userId: "u1",
      asset: "USDT" as never,
      network: "ETHEREUM" as never,
    });

    expect(a).toEqual({ address: "0xabc", custodyRef: "addr-1" });
    expect(sent[0].url).toContain("/crypto");
    expect(sent[0].body).toEqual({
      customer_id: "cust-1",
      coin: "USDT",
      chain: "eth",
      offramp: false,
    });
  });

  it("refuses BTC — no custodian, coming soon", async () => {
    const psp = await makeProvider();
    await expect(
      psp.createDepositAddress({
        userId: "u1",
        asset: "BTC" as never,
        network: "BITCOIN" as never,
      })
    ).rejects.toThrow(/coming soon/);
    expect(findUnique).not.toHaveBeenCalled(); // rejected before any lookup
  });

  it("refuses TRON — Maplerad has no TRON address product", async () => {
    const psp = await makeProvider();
    await expect(
      psp.createDepositAddress({
        userId: "u1",
        asset: "USDT" as never,
        network: "TRON" as never,
      })
    ).rejects.toThrow(/not available/);
  });

  it("refuses a user who was never enrolled with Maplerad", async () => {
    findUnique.mockResolvedValue({ mapleradCustomerId: null });
    const psp = await makeProvider();
    await expect(
      psp.createDepositAddress({
        userId: "u1",
        asset: "USDC" as never,
        network: "ETHEREUM" as never,
      })
    ).rejects.toThrow(/no Maplerad customer/);
  });

  it("sends a withdrawal in cents with an idempotency key, returning the transfer id", async () => {
    const sent = stubFetch({ id: "tr-9", status: "PENDING" });
    const psp = await makeProvider();

    const r = await psp.createWithdrawal({
      userId: "u1",
      asset: "USDC" as never,
      network: "ETHEREUM" as never,
      toAddress: "0xdead",
      amount: "25.50",
    });

    expect(r).toEqual({ txHash: "tr-9", status: "broadcasting" });
    expect(sent[0].url).toContain("/crypto/transfer");
    expect(sent[0].body).toEqual({
      amount: 2550, // $25.50 in cents — never dollars, never 6dp token units
      address: "0xdead",
      chain: "eth",
      coin: "usdc",
      funding_source: "USD",
    });
  });

  it("rejects amounts it cannot represent exactly rather than rounding", async () => {
    const psp = await makeProvider();
    for (const bad of ["25.505", "-3", "abc", "0"]) {
      await expect(
        psp.createWithdrawal({
          userId: "u1",
          asset: "USDT" as never,
          network: "ETHEREUM" as never,
          toAddress: "0xdead",
          amount: bad,
        })
      ).rejects.toThrow(/Invalid withdrawal amount|not available/);
    }
  });

  it("defers webhook handling to the Svix route", async () => {
    const psp = await makeProvider();
    expect(() => psp.verifyWebhookSignature()).toThrow(/Svix/);
    expect(psp.parseDepositEvent()).toBeNull();
    expect(psp.parseWithdrawalEvent()).toBeNull();
  });
});
