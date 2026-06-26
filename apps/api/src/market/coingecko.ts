import { Asset, Prisma } from "@cheqpay/db";
import type { Candle, ChartRange, PriceFeed } from "./types";

const CG_BASE = "https://api.coingecko.com/api/v3";

const COIN_ID: Partial<Record<Asset, string>> = {
  [Asset.BTC]: "bitcoin",
  [Asset.USDT]: "tether",
};

const RANGE_DAYS: Record<ChartRange, string> = {
  day: "1",
  week: "7",
  month: "30",
  year: "365",
  all: "max",
};

/** Pure: parse CoinGecko /simple/price response for a coin id (USD). */
export function parseSimplePrice(json: unknown, coinId: string): Prisma.Decimal {
  const obj = json as Record<string, { usd?: number }> | null;
  const usd = obj?.[coinId]?.usd;
  if (typeof usd !== "number") throw new Error("Unexpected CoinGecko price response");
  return new Prisma.Decimal(usd);
}

/** Pure: parse CoinGecko /market_chart prices ([ms, price][]) into candles. */
export function parseMarketChart(json: unknown): Candle[] {
  const prices = (json as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) throw new Error("Unexpected CoinGecko chart response");
  // market_chart gives points, not OHLC; map each point to a flat candle.
  return prices.map((p) => {
    const [t, price] = p as [number, number];
    const v = String(price);
    return { time: Number(t), open: v, high: v, low: v, close: v };
  });
}

export class CoinGeckoPriceFeed implements PriceFeed {
  readonly name = "coingecko";

  async getSpotUsdt(asset: Asset): Promise<Prisma.Decimal> {
    if (asset === Asset.USDT) return new Prisma.Decimal(1);
    const id = COIN_ID[asset];
    if (!id) throw new Error(`Unsupported asset for CoinGecko: ${asset}`);
    const res = await fetch(`${CG_BASE}/simple/price?ids=${id}&vs_currencies=usd`);
    if (!res.ok) throw new Error(`CoinGecko price ${res.status}`);
    return parseSimplePrice(await res.json(), id);
  }

  async getCandles(asset: Asset, range: ChartRange): Promise<Candle[]> {
    if (asset === Asset.USDT) return [];
    const id = COIN_ID[asset];
    if (!id) throw new Error(`Unsupported asset for CoinGecko: ${asset}`);
    const res = await fetch(
      `${CG_BASE}/coins/${id}/market_chart?vs_currency=usd&days=${RANGE_DAYS[range]}`
    );
    if (!res.ok) throw new Error(`CoinGecko chart ${res.status}`);
    return parseMarketChart(await res.json());
  }
}
