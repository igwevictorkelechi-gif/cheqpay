import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/features", () => ({ assertFeatureEnabled: vi.fn(async () => undefined) }));
vi.mock("@/lib/ratelimit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ensurePriceAlerts", () => ({ ensurePriceAlertsSchema: vi.fn(async () => undefined) }));

const count = vi.fn();
const create = vi.fn();
const findMany = vi.fn();
vi.mock("@cheqpay/db", () => {
  // Defined inside the factory: vi.mock is hoisted above the file's own ESM
  // imports, so a top-level class referenced here would hit its TDZ.
  class Decimal {
    constructor(private v: string | number) {}
    toString() {
      return String(this.v);
    }
  }
  return {
    Asset: { BTC: "BTC", USDT: "USDT", USDC: "USDC" },
    Prisma: { Decimal },
    prisma: {
      priceAlert: {
        count: (...a: unknown[]) => count(...a),
        create: (...a: unknown[]) => create(...a),
        findMany: (...a: unknown[]) => findMany(...a),
      },
    },
  };
});

import { GET, POST } from "./route";
import { Prisma } from "@cheqpay/db";
const Decimal = Prisma.Decimal as unknown as new (v: string | number) => { toString(): string };

const body = (b: unknown) =>
  new Request("https://api.test/api/price-alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  });

describe("POST /api/price-alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an alert and returns it serialized", async () => {
    count.mockResolvedValueOnce(3);
    create.mockResolvedValueOnce({
      id: "a1",
      asset: "BTC",
      direction: "ABOVE",
      targetUsd: new Decimal("70000"),
      active: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      lastTriggeredAt: null,
    });
    const res = await POST(body({ asset: "BTC", direction: "ABOVE", target: "70000" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      alert: {
        id: "a1",
        asset: "BTC",
        direction: "ABOVE",
        target: "70000",
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastTriggeredAt: null,
      },
    });
  });

  it("refuses when the user is at the active-alert cap", async () => {
    count.mockResolvedValueOnce(20);
    const res = await POST(body({ asset: "BTC", direction: "ABOVE", target: "70000" }));
    expect(res.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an invalid target", async () => {
    const res = await POST(body({ asset: "BTC", direction: "ABOVE", target: "-5" }));
    expect([400, 422]).toContain(res.status);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an unsupported asset", async () => {
    const res = await POST(body({ asset: "DOGE", direction: "ABOVE", target: "1" }));
    expect([400, 422]).toContain(res.status);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("GET /api/price-alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the user's alerts serialized", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "a1",
        asset: "BTC",
        direction: "BELOW",
        targetUsd: new Decimal("55000"),
        active: false,
        createdAt: new Date("2026-02-02T00:00:00Z"),
        lastTriggeredAt: new Date("2026-02-03T00:00:00Z"),
      },
    ]);
    const res = await GET(new Request("https://api.test/api/price-alerts"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.alerts[0]).toEqual({
      id: "a1",
      asset: "BTC",
      direction: "BELOW",
      target: "55000",
      active: false,
      createdAt: "2026-02-02T00:00:00.000Z",
      lastTriggeredAt: "2026-02-03T00:00:00.000Z",
    });
  });
});
