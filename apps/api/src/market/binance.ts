import { Asset, Prisma } from "@cheqpay/db";
import { getEnv } from "@/lib/env";
import type { Candle, ChartRange, PriceFeed } from "./types";

// Binance kline interval + count per UI range.
const RANGE: Record<ChartRange, { interval: string; limit: number }> = {
  day: { interval: "15m", limit: 96 }, // 24h
  week: { interval: "1h", limit: 168 }, // 7d
  month: { interval: "4h", limit: 180 }, // ~30d
  year: { interval: "1d", limit: 365 },
  all: { interval: "1w", limit: 1000 },
};

function symbolFor(asset: Asset): string | null {
  if (asset === Asset.BTC) return "BTCUSDT";
  if (asset === Asset.USDC) return "USDCUSDT";
  return null; // USDT handled as 1; others unsupported here
}

/** Pure: parse Binance /ticker/price response. */
export function parseTicker(json: unknown): Prisma.Decimal {
  if (!json || typeof json !== "object" || typeof (json as { price?: unknown }).price !== "string") {
    throw new Error("Unexpected Binance ticker response");
  }
  return new Prisma.Decimal((json as { price: string }).price);
}

/** Pure: parse Binance /klines response into candles. */
export function parseKlines(json: unknown): Candle[] {
  if (!Array.isArray(json)) throw new Error("Unexpected Binance klines response");
  return json.map((k) => {
    const row = k as unknown[];
    return {
      time: Number(row[0]),
      open: String(row[1]),
      high: String(row[2]),
      low: String(row[3]),
      close: String(row[4]),
    };
  });
}

export class BinancePriceFeed implements PriceFeed {
  readonly name = "binance";

  private base() {
    return getEnv().BINANCE_API_BASE;
  }

  async getSpotUsdt(asset: Asset): Promise<Prisma.Decimal> {
    if (asset === Asset.USDT) return new Prisma.Decimal(1);
    const symbol = symbolFor(asset);
    if (!symbol) throw new Error(`Unsupported asset for Binance: ${asset}`);
    const res = await fetch(`${this.base()}/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) throw new Error(`Binance ticker ${res.status}`);
    return parseTicker(await res.json());
  }

  async getCandles(asset: Asset, range: ChartRange): Promise<Candle[]> {
    if (asset === Asset.USDT) return [];
    const symbol = symbolFor(asset);
    if (!symbol) throw new Error(`Unsupported asset for Binance: ${asset}`);
    const { interval, limit } = RANGE[range];
    const res = await fetch(
      `${this.base()}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    if (!res.ok) throw new Error(`Binance klines ${res.status}`);
    return parseKlines(await res.json());
  }
}
