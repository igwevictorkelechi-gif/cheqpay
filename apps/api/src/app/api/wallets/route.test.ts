import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findUnique: vi.fn(),
  provisionWallets: vi.fn(),
  listWallets: vi.fn(),
  offrampOn: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { USDT: "USDT", USDC: "USDC", BTC: "BTC" },
  Network: {
    SOLANA: "SOLANA",
    BASE: "BASE",
    POLYGON: "POLYGON",
    ETHEREUM: "ETHEREUM",
    TRON: "TRON",
    BSC: "BSC",
    BITCOIN: "BITCOIN",
    FIAT: "FIAT",
  },
  prisma: { user: { findUnique: h.findUnique } },
}));
vi.mock("@/lib/auth", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/wallets", () => ({
  provisionWallets: h.provisionWallets,
  listWallets: h.listWallets,
}));
vi.mock("@/lib/settings", () => ({ getCryptoOfframp: h.offrampOn }));

import { GET, POST } from "./route";

function call(body?: unknown) {
  return POST(
    new Request("https://api/x", {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** The offramp flag a request ended up provisioning with. */
function offrampArg(): boolean | undefined {
  return h.provisionWallets.mock.calls.at(-1)?.[2];
}

describe("POST /api/wallets — the chain decides whether it must offramp (off-ramp on)", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.requireUser.mockResolvedValue({ id: "u1" });
    h.findUnique.mockResolvedValue({ id: "u1" });
    h.provisionWallets.mockResolvedValue([]);
    h.offrampOn.mockResolvedValue(true);
  });

  it("offramps a chain the user could never send from, without being asked", async () => {
    // This is the bug: the clients send no `offramp`, so every non-Solana
    // request used to inherit the false default and be refused by custody.
    for (const network of ["BASE", "POLYGON", "ETHEREUM", "TRON", "BSC"]) {
      const res = await call({ asset: "USDC", network });
      expect(res.status, `${network} should mint`).toBe(200);
      expect(offrampArg(), `${network} must offramp`).toBe(true);
    }
  });

  it("keeps Solana holding real coin", async () => {
    const res = await call({ asset: "USDT", network: "SOLANA" });
    expect(res.status).toBe(200);
    expect(offrampArg()).toBe(false);
  });

  it("honours an explicit offramp from the caller either way", async () => {
    await call({ asset: "USDC", network: "SOLANA", offramp: true });
    expect(offrampArg()).toBe(true);

    // Explicit false on an unsendable chain is still passed through — custody
    // is the layer that refuses it, and it should say so rather than be
    // silently overridden here.
    await call({ asset: "USDC", network: "BASE", offramp: false });
    expect(offrampArg()).toBe(false);
  });

  it("refuses a pair that cannot be minted at all", async () => {
    const res = await call({ asset: "BTC", network: "BITCOIN" });
    expect(res.status).toBe(422);
    expect(h.provisionWallets).not.toHaveBeenCalled();
  });

  it("mints the launch set when no pair is given", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    // No explicit pair and no offramp override.
    expect(h.provisionWallets).toHaveBeenCalledWith("u1");
  });
});

describe("/api/wallets with the off-ramp switched off", () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset());
    h.requireUser.mockResolvedValue({ id: "u1" });
    h.findUnique.mockResolvedValue({ id: "u1" });
    h.provisionWallets.mockResolvedValue([]);
    h.listWallets.mockResolvedValue([]);
    h.offrampOn.mockResolvedValue(false);
  });

  it("refuses a chain other than Solana, saying where it can be received", async () => {
    const res = await call({ asset: "USDT", network: "TRON" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("USDT can only be received on Solana right now.");
    expect(h.provisionWallets).not.toHaveBeenCalled();
  });

  it("mints Solana as real coin, even when the caller asks to convert", async () => {
    const res = await call({ asset: "USDT", network: "SOLANA", offramp: true });
    expect(res.status).toBe(200);
    expect(offrampArg()).toBe(false);
  });

  it("offers only Solana", async () => {
    const body = await (await GET(new Request("https://api/x"))).json();
    expect(new Set(body.available.map((w: { network: string }) => w.network))).toEqual(new Set(["SOLANA"]));
  });
});
