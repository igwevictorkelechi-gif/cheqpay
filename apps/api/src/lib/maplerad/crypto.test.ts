import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wire-shape tests for the stablecoin endpoints.
 *
 * These live here rather than in custody/maplerad.test.ts because this is the
 * layer where coin and chain are parameters rather than a fixed table, so both
 * halves of Maplerad's casing split can actually be exercised:
 *
 *   POST /crypto           coin enum ["USDC","USDT","PYUSD"]  (upper)
 *   POST /crypto/transfer  coin enum ["usdc","usdt","pyusd"]  (lower)
 *
 * Sending the wrong case is rejected by the provider, and sending the wrong
 * chain on a withdrawal is worse than rejected — it is money that arrived
 * somewhere it cannot leave.
 */

function stubFetch(response: unknown) {
  const sent: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    sent.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify({ status: true, data: response }), { status: 200 });
  });
  return sent;
}

async function load() {
  // client.ts reads MAPLERAD_SECRET_KEY at module load.
  process.env.MAPLERAD_SECRET_KEY = "sk-test";
  vi.resetModules();
  const mod = await import("./crypto");
  mod.setCryptoGuard(() => {});
  return mod;
}

beforeEach(() => {
  delete process.env.MAPLERAD_BASE_URL;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDepositAddress — POST /crypto", () => {
  it("sends the coin upper-cased, as that endpoint's enum requires", async () => {
    const sent = stubFetch({ id: "addr-1", address: "0xabc", chain: "eth", coin: "USDT" });
    const { createDepositAddress } = await load();

    await createDepositAddress({ customerId: "cus_1", coin: "USDT", chain: "eth" });

    expect(sent[0].url).toContain("/crypto");
    expect(sent[0].body).toEqual({
      customer_id: "cus_1",
      coin: "USDT",
      chain: "eth",
      offramp: false,
    });
  });

  it("defaults to USDC on Solana with offramp off", async () => {
    const sent = stubFetch({ id: "addr-2", address: "sol1", chain: "solana", coin: "USDC" });
    const { createDepositAddress } = await load();

    await createDepositAddress({ customerId: "cus_1" });

    expect(sent[0].body).toEqual({
      customer_id: "cus_1",
      coin: "USDC",
      chain: "solana",
      // `offramp`, not `off_ramp` — Maplerad's schema and response say offramp
      // while its worked example says off_ramp. Sending the wrong name means
      // deposits silently stop converting to USD.
      offramp: false,
    });
  });

  it("passes offramp through when asked to auto-convert", async () => {
    const sent = stubFetch({ id: "addr-3", address: "sol1", chain: "solana", coin: "USDC" });
    const { createDepositAddress } = await load();

    await createDepositAddress({ customerId: "cus_1", offramp: true });

    expect(sent[0].body).toMatchObject({ offramp: true });
  });

  it("stays behind the crypto feature guard", async () => {
    stubFetch({});
    process.env.MAPLERAD_SECRET_KEY = "sk-test";
    vi.resetModules();
    // Deliberately NOT calling setCryptoGuard: the default guard must throw, so
    // an accidental import cannot expose crypto ahead of VASP registration.
    const { createDepositAddress } = await import("./crypto");
    await expect(createDepositAddress({ customerId: "cus_1" })).rejects.toThrow(/gated/i);
  });
});

describe("withdrawStablecoin — POST /crypto/transfer", () => {
  it("lower-cases the coin, because this endpoint's enum is lower-case", async () => {
    const sent = stubFetch({ id: "tr-1", status: "SUCCESS" });
    const { withdrawStablecoin } = await load();

    // Coin is spelled upper-case throughout our code; only the wire differs.
    await withdrawStablecoin({
      amount: 2550 as never,
      address: "sol-addr",
      chain: "solana",
      coin: "USDT",
    });

    expect(sent[0].url).toContain("/crypto/transfer");
    expect(sent[0].body.coin).toBe("usdt");
  });

  it("defaults to usdc, lower-case, funded from USD", async () => {
    const sent = stubFetch({ id: "tr-2", status: "SUCCESS" });
    const { withdrawStablecoin } = await load();

    await withdrawStablecoin({ amount: 100 as never, address: "sol-addr", chain: "solana" });

    expect(sent[0].body).toMatchObject({
      amount: 100,
      address: "sol-addr",
      chain: "solana",
      coin: "usdc",
      funding_source: "USD",
    });
  });

  it("sends the reference as an idempotency key so a retry cannot double-send", async () => {
    const sent = stubFetch({ id: "tr-3", status: "PENDING" });
    const { withdrawStablecoin } = await load();

    await withdrawStablecoin({
      amount: 100 as never,
      address: "sol-addr",
      chain: "solana",
      reference: "ref-1",
    });

    expect(sent[0].headers["Idempotency-Key"]).toBe("ref-1");
    expect(sent[0].body.reference).toBe("ref-1");
  });

  it("stays behind the crypto feature guard", async () => {
    stubFetch({});
    process.env.MAPLERAD_SECRET_KEY = "sk-test";
    vi.resetModules();
    const { withdrawStablecoin } = await import("./crypto");
    await expect(
      withdrawStablecoin({ amount: 100 as never, address: "a", chain: "solana" })
    ).rejects.toThrow(/gated/i);
  });
});
