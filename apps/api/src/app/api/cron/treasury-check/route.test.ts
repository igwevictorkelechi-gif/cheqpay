import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  groupBy: vi.fn(),
  getWallets: vi.fn(),
  alert: vi.fn(),
  env: { CRON_SECRET: "cron-secret-123" } as Record<string, string | undefined>,
}));

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN", USD: "USD" },
  prisma: { balance: { groupBy: h.groupBy } },
}));
vi.mock("@/lib/env", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/maplerad/wallets", () => ({ getWallets: h.getWallets }));
vi.mock("@/lib/adminAlert", () => ({ notifyAdminAlert: h.alert }));

import { GET } from "./route";

const call = (auth = "Bearer cron-secret-123") =>
  GET(new Request("https://api.example/api/cron/treasury-check", { headers: { authorization: auth } }));
const wallet = (currency: string, available: number) => ({
  currency, available_balance: available, active: true, disabled: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.groupBy.mockResolvedValue([
    { asset: "USD", _sum: { available: 16_701n, locked: 0n } },
    { asset: "NGN", _sum: { available: 50_000_00n, locked: 0n } },
  ]);
});

describe("treasury check", () => {
  it("alerts with the top-up needed when Maplerad holds less than users are owed", async () => {
    h.getWallets.mockResolvedValue([wallet("USD", 16_100), wallet("NGN", 90_000_00)]);
    const res = await call();
    const body = await res.json();
    expect(body.alerted).toBe(true);
    expect(body.report.find((r: { currency: string }) => r.currency === "USD").shortMinor).toBe("601");
    expect(h.alert).toHaveBeenCalledTimes(1);
    expect(h.alert.mock.calls[0][0]).toContain("top up $6.01");
  });

  it("stays quiet when the pool covers what users hold", async () => {
    h.getWallets.mockResolvedValue([wallet("USD", 20_000), wallet("NGN", 90_000_00)]);
    const body = await (await call()).json();
    expect(body.alerted).toBe(false);
    expect(h.alert).not.toHaveBeenCalled();
  });

  it("refuses without the cron secret", async () => {
    const res = await call("Bearer nope");
    expect(res.status).toBe(401);
    expect(h.getWallets).not.toHaveBeenCalled();
  });
});
