import { Asset, Prisma } from "@cheqpay/db";
import type { Candle, ChartRange, PriceFeed } from "./types";

/** Deterministic price feed for development/tests (no network). */
export class MockPriceFeed implements PriceFeed {
  readonly name = "mock";

  private spot(asset: Asset): Prisma.Decimal {
    if (asset === Asset.USDT) return new Prisma.Decimal(1);
    if (asset === Asset.BTC) return new Prisma.Decimal("60000");
    return new Prisma.Decimal(0);
  }

  async getSpotUsdt(asset: Asset): Promise<Prisma.Decimal> {
    return this.spot(asset);
  }

  async getCandles(asset: Asset, range: ChartRange): Promise<Candle[]> {
    if (asset === Asset.USDT) return [];
    const base = this.spot(asset).toNumber();
    const counts: Record<ChartRange, number> = {
      day: 24,
      week: 7,
      month: 30,
      year: 52,
      all: 60,
    };
    const n = counts[range];
    const now = Date.now();
    return Array.from({ length: n }, (_, i) => {
      const v = (base * (0.9 + (0.2 * i) / n)).toFixed(2);
      return { time: now - (n - i) * 3_600_000, open: v, high: v, low: v, close: v };
    });
  }
}
