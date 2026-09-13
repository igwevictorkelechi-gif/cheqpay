import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@cheqpay/db", () => ({
  prisma: {
    platformSetting: {
      findUnique: h.findUnique,
      findMany: h.findMany,
      upsert: h.upsert,
      deleteMany: h.deleteMany,
    },
  },
}));
vi.mock("./env", () => ({ getEnv: () => ({ SWAP_SPREAD_BPS: 100 }) }));

import {
  getBillMarginBps,
  getBillMargins,
  getDepositMinUsd,
  getFxMarginBps,
  getFxMargins,
  getFxSideMarginBps,
  getWithdrawalMinNgn,
  getWithdrawalMinUsd,
  setBillMarginForService,
} from "./settings";

/** Wire findUnique from a plain key -> value map. */
function withSettings(map: Record<string, string>) {
  h.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key in map ? { key: where.key, value: map[where.key] } : null,
  );
  h.findMany.mockImplementation(async ({ where }: { where: { key: { in: string[] } } }) =>
    where.key.in.filter((k) => k in map).map((k) => ({ key: k, value: map[k] })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  withSettings({});
  h.upsert.mockResolvedValue(undefined);
  h.deleteMany.mockResolvedValue({ count: 1 });
});

describe("per-service bill margins", () => {
  it("falls back to the shared default when a service has no rate of its own", async () => {
    withSettings({ bill_margin_bps: "250" });
    await expect(getBillMarginBps("data")).resolves.toBe(250);
    await expect(getBillMarginBps("airtime")).resolves.toBe(250);
  });

  it("lets a service override the default", async () => {
    withSettings({ bill_margin_bps: "250", bill_margin_data_bps: "300" });
    await expect(getBillMarginBps("data")).resolves.toBe(300);
    await expect(getBillMarginBps("electricity")).resolves.toBe(250);
  });

  it("treats an explicit 0 as a real rate, not as unset", async () => {
    // This is the whole point of the override: airtime sells at face value
    // while everything else still carries the default markup.
    withSettings({ bill_margin_bps: "300", bill_margin_airtime_bps: "0" });
    await expect(getBillMarginBps("airtime")).resolves.toBe(0);
    await expect(getBillMarginBps("data")).resolves.toBe(300);
  });

  it("is 0 when nothing at all is configured", async () => {
    await expect(getBillMarginBps("data")).resolves.toBe(0);
    await expect(getBillMarginBps()).resolves.toBe(0);
  });

  it("reads the shared default when asked without a service", async () => {
    withSettings({ bill_margin_bps: "150", bill_margin_data_bps: "900" });
    await expect(getBillMarginBps()).resolves.toBe(150);
  });

  it("reports every service for the dashboard, null where it uses the default", async () => {
    withSettings({ bill_margin_bps: "100", bill_margin_data_bps: "300", bill_margin_airtime_bps: "0" });
    await expect(getBillMargins()).resolves.toEqual({
      defaultBps: 100,
      perService: {
        airtime: 0,
        data: 300,
        electricity: null,
        cabletv: null,
        betting: null,
        food: null,
      },
    });
  });

  it("clears an override with null rather than writing a zero", async () => {
    await setBillMarginForService("data", null);
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { key: "bill_margin_data_bps" } });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("writes a rate as its own row", async () => {
    await setBillMarginForService("airtime", 0, "admin@cheqpay");
    expect(h.deleteMany).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "bill_margin_airtime_bps" } }),
    );
  });
});

describe("the NGN<->USD spread", () => {
  it("is 0 until an admin sets it", async () => {
    await expect(getFxMarginBps()).resolves.toBe(0);
  });

  it("is read from its own key, not from the crypto swap spread", async () => {
    withSettings({ fx_margin_bps: "100", swap_spread_bps: "250" });
    await expect(getFxMarginBps()).resolves.toBe(100);
  });
});

describe("the two sides of the NGN<->USD book", () => {
  it("falls back to the shared spread when a side has no rate of its own", async () => {
    withSettings({ fx_margin_bps: "100" });
    await expect(getFxSideMarginBps("buy_usd")).resolves.toBe(100);
    await expect(getFxSideMarginBps("sell_usd")).resolves.toBe(100);
  });

  it("lets the sides differ, so dollars leave dearer than they arrive", async () => {
    withSettings({
      fx_margin_bps: "100",
      fx_margin_buy_usd_bps: "75",
      fx_margin_sell_usd_bps: "150",
    });
    await expect(getFxSideMarginBps("buy_usd")).resolves.toBe(75);
    await expect(getFxSideMarginBps("sell_usd")).resolves.toBe(150);
  });

  it("treats an explicit 0 on one side as a real rate", async () => {
    withSettings({ fx_margin_bps: "100", fx_margin_buy_usd_bps: "0" });
    await expect(getFxSideMarginBps("buy_usd")).resolves.toBe(0);
    await expect(getFxSideMarginBps("sell_usd")).resolves.toBe(100);
  });

  it("reports both sides for the dashboard, null where each uses the default", async () => {
    withSettings({ fx_margin_bps: "100", fx_margin_sell_usd_bps: "150" });
    await expect(getFxMargins()).resolves.toEqual({
      defaultBps: 100,
      buyUsdBps: null,
      sellUsdBps: 150,
    });
  });
});

describe("minimums", () => {
  it("are 0 — no floor — until an admin sets them", async () => {
    await expect(getWithdrawalMinNgn()).resolves.toBe(0);
    await expect(getWithdrawalMinUsd()).resolves.toBe(0);
    await expect(getDepositMinUsd()).resolves.toBe(0);
  });

  it("read back what was set", async () => {
    withSettings({
      withdrawal_min_ngn: "2000",
      withdrawal_min_usd: "5",
      deposit_min_usd: "5",
    });
    await expect(getWithdrawalMinNgn()).resolves.toBe(2000);
    await expect(getWithdrawalMinUsd()).resolves.toBe(5);
    await expect(getDepositMinUsd()).resolves.toBe(5);
  });
});
