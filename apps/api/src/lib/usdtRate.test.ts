import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  quoteFx: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("./maplerad/fx", () => ({ quoteFx: h.quoteFx }));
vi.mock("./opsAlert", () => ({ alertOpsOnce: h.alert }));
vi.mock("@cheqpay/db", () => ({
  prisma: { platformSetting: { upsert: h.upsert, findUnique: h.findUnique } },
}));

import {
  AUTO_UPDATED_BY,
  LIVE_RATE_TTL_MS,
  RETRY_AFTER_FAILURE_MS,
  fetchMapleradUsdNgn,
  followMapleradRate,
  rejectLiveRate,
  resetUsdtRateState,
} from "./usdtRate";
import { getUsdtNgnRate, getUsdtNgnRateDetails } from "./settings";

const NOW = Date.UTC(2026, 9, 24, 9, 30);
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

/** Maplerad's answer for $100 at `rate` NGN per $1. */
function quoteAt(rate: number) {
  return {
    reference: "fxq_1",
    source: { currency: "USD", amount: 10_000, human_readable_amount: 100 },
    target: { currency: "NGN", amount: Math.round(rate * 10_000), human_readable_amount: rate * 100 },
    rate: 1 / rate,
  };
}

beforeEach(() => {
  resetUsdtRateState();
  h.upsert.mockResolvedValue({});
  h.alert.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete process.env.MAPLERAD_SECRET_KEY;
});

describe("fetchMapleradUsdNgn", () => {
  it("reads NGN per $1 from the quote's legs, asking for $100", async () => {
    h.quoteFx.mockResolvedValue(quoteAt(1354.43));
    await expect(fetchMapleradUsdNgn()).resolves.toBe(1354.43);
    expect(h.quoteFx).toHaveBeenCalledWith(
      { sourceCurrency: "USD", targetCurrency: "NGN", amount: 10_000 },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("refuses a quote without amounts", async () => {
    h.quoteFx.mockResolvedValue({ reference: "x", source: {}, target: {} });
    await expect(fetchMapleradUsdNgn()).rejects.toThrow(/usable amounts/);
  });
});

describe("rejectLiveRate", () => {
  it("accepts a normal move", () => {
    expect(rejectLiveRate(1362, 1355)).toBeNull();
    expect(rejectLiveRate(1355, null)).toBeNull();
  });
  it("refuses an inverted or absurd rate", () => {
    expect(rejectLiveRate(0.00074, 1355)).toMatch(/not a plausible/);
    expect(rejectLiveRate(500_000, null)).toMatch(/not a plausible/);
  });
  it("refuses a jump over 5%", () => {
    expect(rejectLiveRate(1450, 1355)).toMatch(/7\.0%/);
    expect(rejectLiveRate(1280, 1355)).toMatch(/-5\.5%/);
  });
});

describe("followMapleradRate", () => {
  it("uses the stored rate while it is fresh, without asking Maplerad", async () => {
    await expect(followMapleradRate(1355, minutesAgo(3), NOW)).resolves.toEqual({ rate: 1355, fresh: false });
    expect(h.quoteFx).not.toHaveBeenCalled();
  });

  it("refreshes a stale rate and saves it for every instance", async () => {
    h.quoteFx.mockResolvedValue(quoteAt(1358.5));
    await expect(followMapleradRate(1355, minutesAgo(11), NOW)).resolves.toEqual({ rate: 1358.5, fresh: true });
    expect(h.upsert).toHaveBeenCalledWith({
      where: { key: "usdt_ngn_rate" },
      update: { value: "1358.5", updatedBy: AUTO_UPDATED_BY },
      create: { key: "usdt_ngn_rate", value: "1358.5", updatedBy: AUTO_UPDATED_BY },
    });
  });

  it("asks Maplerad once when many prices are read together", async () => {
    h.quoteFx.mockResolvedValue(quoteAt(1356));
    const all = await Promise.all([1, 2, 3].map(() => followMapleradRate(1355, minutesAgo(30), NOW)));
    expect(all.map((r) => r.rate)).toEqual([1356, 1356, 1356]);
    expect(h.quoteFx).toHaveBeenCalledOnce();
  });

  it("keeps the stored rate when Maplerad fails, and backs off", async () => {
    h.quoteFx.mockRejectedValue(new Error("HTTP 503"));
    await expect(followMapleradRate(1355, minutesAgo(20), NOW)).resolves.toEqual({ rate: 1355, fresh: false });
    expect(h.upsert).not.toHaveBeenCalled();
    // Not old enough to wake anyone.
    expect(h.alert).not.toHaveBeenCalled();

    await followMapleradRate(1355, minutesAgo(20), NOW + 30_000);
    expect(h.quoteFx).toHaveBeenCalledOnce();

    h.quoteFx.mockResolvedValue(quoteAt(1356));
    await expect(
      followMapleradRate(1355, minutesAgo(20), NOW + RETRY_AFTER_FAILURE_MS + 1),
    ).resolves.toEqual({ rate: 1356, fresh: true });
  });

  it("alerts ops when the stored rate has gone over an hour without a refresh", async () => {
    h.quoteFx.mockRejectedValue(new Error("HTTP 503"));
    await followMapleradRate(1355, minutesAgo(90), NOW);
    expect(h.alert).toHaveBeenCalledWith("usdt-rate-refresh-failed", expect.stringContaining("₦1355"), expect.any(Object), NOW);
  });

  it("does not follow a jump over 5%: keeps the stored rate and alerts ops", async () => {
    h.quoteFx.mockResolvedValue(quoteAt(1460));
    await expect(followMapleradRate(1355, minutesAgo(15), NOW)).resolves.toEqual({ rate: 1355, fresh: false });
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.alert).toHaveBeenCalledWith("usdt-rate-refused", expect.stringContaining("7.7%"), expect.any(Object), NOW);
  });

  it("still prices with a fetched rate when saving it fails", async () => {
    h.quoteFx.mockResolvedValue(quoteAt(1357));
    h.upsert.mockRejectedValue(new Error("db down"));
    await expect(followMapleradRate(1355, minutesAgo(15), NOW)).resolves.toEqual({ rate: 1357, fresh: true });
  });
});

describe("getUsdtNgnRate", () => {
  function rows(rate: { value: string; updatedAt: Date } | null, source: string | null) {
    h.findUnique.mockImplementation(({ where: { key } }: { where: { key: string } }) =>
      Promise.resolve(
        key === "usdt_ngn_rate"
          ? rate && { key, ...rate, updatedBy: "admin@cheqpay.com" }
          : key === "usdt_ngn_rate_source" && source !== null
            ? { key, value: source, updatedAt: new Date(), updatedBy: "admin@cheqpay.com" }
            : null,
      ),
    );
  }

  it("is the stored rate when Maplerad is not configured", async () => {
    rows({ value: "1360", updatedAt: new Date(Date.now() - 2 * LIVE_RATE_TTL_MS) }, null);
    await expect(getUsdtNgnRate()).resolves.toBe(1360);
    expect(h.quoteFx).not.toHaveBeenCalled();
  });

  it("follows Maplerad by default once Maplerad is configured", async () => {
    process.env.MAPLERAD_SECRET_KEY = "test";
    rows({ value: "1355", updatedAt: new Date(Date.now() - 2 * LIVE_RATE_TTL_MS) }, null);
    h.quoteFx.mockResolvedValue(quoteAt(1354));
    const details = await getUsdtNgnRateDetails();
    expect(details).toMatchObject({ rate: 1354, source: "maplerad", updatedBy: AUTO_UPDATED_BY });
  });

  it("keeps an admin's typed rate when the source is manual", async () => {
    process.env.MAPLERAD_SECRET_KEY = "test";
    rows({ value: "1340", updatedAt: new Date(Date.now() - 2 * LIVE_RATE_TTL_MS) }, "manual");
    await expect(getUsdtNgnRateDetails()).resolves.toMatchObject({
      rate: 1340,
      source: "manual",
      updatedBy: "admin@cheqpay.com",
    });
    expect(h.quoteFx).not.toHaveBeenCalled();
  });
});
