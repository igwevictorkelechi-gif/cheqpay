import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listWallets: vi.fn(),
  provisionWalletsDetailed: vi.fn(),
  getFeatureFlags: vi.fn(),
  getManualWallets: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { BTC: "BTC", USDT: "USDT", USDC: "USDC" },
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
}));
vi.mock("@/lib/auth", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/wallets", () => ({
  listWallets: h.listWallets,
  provisionWalletsDetailed: h.provisionWalletsDetailed,
}));
vi.mock("@/lib/features", () => ({ getFeatureFlags: h.getFeatureFlags }));
vi.mock("@/lib/manualCrypto", () => ({
  getManualWallets: h.getManualWallets,
  MANUAL_ASSETS: ["BTC", "USDT", "USDC"],
}));

import { GET } from "./route";

let userSeq = 0;
/** A fresh user id per call — the throttle below is keyed on it. */
function call() {
  h.requireUser.mockResolvedValue({ id: `u${++userSeq}` });
  return GET(new Request("https://api/x"));
}

/** Reuse one user id across calls, to exercise the throttle. */
function callAs(id: string) {
  h.requireUser.mockResolvedValue({ id });
  return GET(new Request("https://api/x"));
}

describe("GET /api/crypto/deposit-addresses — stored addresses answer on their own", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.getFeatureFlags.mockResolvedValue({ crypto_deposits: true });
    h.getManualWallets.mockResolvedValue({});
    h.listWallets.mockResolvedValue([]);
    h.provisionWalletsDetailed.mockResolvedValue({ wallets: [], outcomes: [] });
  });

  it("serves addresses straight from the database without calling the provider", async () => {
    // This is the whole point: once a wallet row exists, displaying it is a
    // single indexed read and custody is never involved.
    h.listWallets.mockResolvedValue([
      { asset: "USDT", network: "SOLANA", address: "BvH5k" },
      { asset: "USDC", network: "BASE", address: "0xabc" },
    ]);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.addresses).toHaveLength(2);
    expect(body.addresses[0]).toMatchObject({
      asset: "USDT",
      address: "BvH5k",
      networkLabel: "Solana (SPL)",
      managed: true,
    });
    expect(h.provisionWalletsDetailed).not.toHaveBeenCalled();
  });

  it("reads the flags, the wallets and the manual set concurrently", async () => {
    // Sequential round trips to Postgres are most of what the receive screen
    // spends its time on, so a regression to `await` in a row matters.
    const started: string[] = [];
    const gate = (name: string, value: unknown) =>
      vi.fn(async () => {
        started.push(name);
        await new Promise((r) => setTimeout(r, 5));
        return value;
      });
    h.getFeatureFlags.mockImplementation(gate("flags", { crypto_deposits: true }));
    h.listWallets.mockImplementation(gate("wallets", []));
    h.getManualWallets.mockImplementation(gate("manual", {}));

    await call();

    // All three entered before any of them resolved.
    expect(started).toEqual(["flags", "wallets", "manual"]);
  });

  it("tries to mint for a user with no wallets — once, not on every visit", async () => {
    // A user whose minting cannot succeed has no wallets every single time. Left
    // unthrottled the screen calls the provider on every open and waits for the
    // same failure.
    h.provisionWalletsDetailed.mockResolvedValue({
      wallets: [],
      outcomes: [{ asset: "USDT", network: "SOLANA", status: "failed", error: "custody down" }],
    });

    await callAs("repeat-user");
    await callAs("repeat-user");
    await callAs("repeat-user");

    expect(h.provisionWalletsDetailed).toHaveBeenCalledTimes(1);
  });

  it("still reports why an address is missing while throttled", async () => {
    h.provisionWalletsDetailed.mockResolvedValue({ wallets: [], outcomes: [] });
    await callAs("throttled-user");

    const body = await (await callAs("throttled-user")).json();
    expect(body.pending.map((p: { asset: string }) => p.asset)).toEqual(["USDT", "USDC"]);
    expect(body.pending[0].reason).toMatch(/still being generated/);
  });

  it("hands back nothing at all while crypto deposits are switched off", async () => {
    h.getFeatureFlags.mockResolvedValue({ crypto_deposits: false });
    const body = await (await call()).json();
    expect(body).toEqual({ addresses: [], networks: [] });
    expect(h.provisionWalletsDetailed).not.toHaveBeenCalled();
  });

  it("never substitutes the shared manual wallet for a mintable coin", async () => {
    // A manual wallet is one address shared by every user, so a deposit into it
    // cannot be attributed to anyone — which is exactly what the crypto webhook
    // needs to credit it.
    h.getManualWallets.mockResolvedValue({
      USDT: { address: "SHARED", networkLabel: "Tron (TRC-20)", network: "TRON" },
      BTC: { address: "bc1shared", networkLabel: "Bitcoin", network: "BITCOIN" },
    });

    const body = await (await call()).json();
    const assets = body.addresses.map((a: { asset: string }) => a.asset);
    expect(assets).toContain("BTC");
    expect(assets).not.toContain("USDT");
  });
});
