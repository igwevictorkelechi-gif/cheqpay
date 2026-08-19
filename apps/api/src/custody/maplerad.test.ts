import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapleradCustodyProvider unit tests. The provider hangs addresses off the
 * user's stored Maplerad customer id and maps Asset/Network onto Maplerad's
 * coin/chain names; both mappings are money-critical.
 *
 * Note both supported pairs are currently disabled by the one-way-chain guard —
 * they are ERC-20, and Maplerad's withdrawal endpoint documents Solana as its
 * only destination — so the tests below assert the refusal rather than the
 * request body. The request body for the two crypto endpoints is covered in
 * lib/maplerad/crypto.test.ts, where coin and chain are parameters instead of a
 * fixed table and both can actually be varied.
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

/**
 * Both shipped pairs are ERC-20 and therefore blocked by the one-way-chain
 * guard, which would otherwise mask every check that runs after it. This builds
 * a provider with the guard satisfied so those checks stay covered — the module
 * is freshly imported each time, so the mutation cannot leak between tests.
 */
async function makeProviderWithWithdrawableEth() {
  process.env.MAPLERAD_SECRET_KEY = "sk-test";
  vi.resetModules();
  const { MapleradCustodyProvider, COIN_CHAIN } = await import("./maplerad");
  // Asset/Network are stubbed as plain strings by the @cheqpay/db mock above,
  // so the real enum keys are not available to index with here.
  const map = COIN_CHAIN as unknown as Record<
    string,
    Record<string, { withdrawable: boolean }> | undefined
  >;
  for (const asset of ["USDT", "USDC"]) {
    const pair = map[asset]?.ETHEREUM;
    if (pair) pair.withdrawable = true;
  }
  return new MapleradCustodyProvider();
}

beforeEach(() => {
  findUnique.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MapleradCustodyProvider", () => {
  it("refuses to mint an ERC-20 address it could not withdraw from", async () => {
    // The trap this guards: POST /crypto mints on eth happily, POST
    // /crypto/transfer documents solana only. An address minted here would take
    // a user's money and have no documented way to give it back.
    findUnique.mockResolvedValue({ mapleradCustomerId: "cust-1" });
    const sent = stubFetch({ id: "addr-1", address: "0xabc", chain: "eth", coin: "USDT" });
    const psp = await makeProvider();

    await expect(
      psp.createDepositAddress({
        userId: "u1",
        asset: "USDT" as never,
        network: "ETHEREUM" as never,
      })
    ).rejects.toThrow(/does not document as a withdrawal destination/);

    // Refused before any provider call — no address exists to be found later.
    expect(sent).toHaveLength(0);
  });

  it("refuses the withdrawal for the same pair, not just the address", async () => {
    // Belt and braces: an address minted before the guard existed must not be
    // able to send an undocumented chain and get an opaque provider refusal.
    const sent = stubFetch({ id: "tr-9", status: "PENDING" });
    const psp = await makeProvider();

    await expect(
      psp.createWithdrawal({
        userId: "u1",
        asset: "USDC" as never,
        network: "ETHEREUM" as never,
        toAddress: "0xdead",
        amount: "25.50",
      })
    ).rejects.toThrow(/does not document as a withdrawal destination/);

    expect(sent).toHaveLength(0);
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

  it("refuses an unsupported pair before looking the user up", async () => {
    const psp = await makeProvider();
    await expect(
      psp.createDepositAddress({
        userId: "u1",
        asset: "USDC" as never,
        network: "BSC" as never,
      })
    ).rejects.toThrow(/not available/);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("refuses a user who was never enrolled with Maplerad", async () => {
    findUnique.mockResolvedValue({ mapleradCustomerId: null });
    const psp = await makeProviderWithWithdrawableEth();
    await expect(
      psp.createDepositAddress({
        userId: "u1",
        asset: "USDC" as never,
        network: "ETHEREUM" as never,
      })
    ).rejects.toThrow(/no Maplerad customer/);
  });

  it("mints against the user's customer id once the chain is withdrawable", async () => {
    findUnique.mockResolvedValue({ mapleradCustomerId: "cust-1" });
    const sent = stubFetch({ id: "addr-1", address: "0xabc", chain: "eth", coin: "USDT" });
    const psp = await makeProviderWithWithdrawableEth();

    const a = await psp.createDepositAddress({
      userId: "u1",
      asset: "USDT" as never,
      network: "ETHEREUM" as never,
    });

    expect(a).toEqual({ address: "0xabc", custodyRef: "addr-1" });
    expect(sent[0].url).toContain("/crypto");
    // Upper-case coin: POST /crypto's enum is upper-case, unlike the transfer
    // endpoint's.
    expect(sent[0].body).toEqual({
      customer_id: "cust-1",
      coin: "USDT",
      chain: "eth",
      offramp: false,
    });
  });

  it("sends a withdrawal in cents with an idempotency key, returning the transfer id", async () => {
    const sent = stubFetch({ id: "tr-9", status: "PENDING" });
    const psp = await makeProviderWithWithdrawableEth();

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
      coin: "usdc", // lower-case: the transfer endpoint's enum, not /crypto's
      funding_source: "USD",
    });
  });

  it("rejects amounts it cannot represent exactly rather than rounding", async () => {
    const psp = await makeProviderWithWithdrawableEth();
    for (const bad of ["25.505", "-3", "abc", "0"]) {
      await expect(
        psp.createWithdrawal({
          userId: "u1",
          asset: "USDT" as never,
          network: "ETHEREUM" as never,
          toAddress: "0xdead",
          amount: bad,
        })
      ).rejects.toThrow(/Invalid withdrawal amount/);
    }
  });

  it("defers webhook handling to the Svix route", async () => {
    const psp = await makeProvider();
    expect(() => psp.verifyWebhookSignature()).toThrow(/Svix/);
    expect(psp.parseDepositEvent()).toBeNull();
    expect(psp.parseWithdrawalEvent()).toBeNull();
  });
});
