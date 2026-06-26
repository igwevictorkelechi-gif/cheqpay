import type { Asset, Prisma } from "@cheqpay/db";
import { getEnv } from "@/lib/env";
import type { Candle, ChartRange, PriceFeed } from "./types";
import { BinancePriceFeed } from "./binance";
import { CoinGeckoPriceFeed } from "./coingecko";
import { MockPriceFeed } from "./mock";

export * from "./types";

/**
 * Tries the primary feed, falls back to the secondary on error, and caches
 * results in-memory with a short TTL so we never hammer provider rate limits.
 */
class CachedFallbackFeed implements PriceFeed {
  readonly name: string;
  private cache = new Map<string, { value: unknown; expires: number }>();

  constructor(
    private primary: PriceFeed,
    private fallback: PriceFeed,
    private spotTtlMs = 15_000,
    private candleTtlMs = 120_000
  ) {
    this.name = `${primary.name}+${fallback.name}`;
  }

  private async cached<T>(key: string, ttl: number, run: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const value = await run();
    this.cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  }

  private async withFallback<T>(op: (f: PriceFeed) => Promise<T>): Promise<T> {
    try {
      return await op(this.primary);
    } catch {
      return op(this.fallback);
    }
  }

  getSpotUsdt(asset: Asset): Promise<Prisma.Decimal> {
    return this.cached(`spot:${asset}`, this.spotTtlMs, () =>
      this.withFallback((f) => f.getSpotUsdt(asset))
    );
  }

  getCandles(asset: Asset, range: ChartRange): Promise<Candle[]> {
    return this.cached(`candles:${asset}:${range}`, this.candleTtlMs, () =>
      this.withFallback((f) => f.getCandles(asset, range))
    );
  }
}

let cached: PriceFeed | null = null;

export function getPriceFeed(): PriceFeed {
  if (cached) return cached;
  cached =
    getEnv().PRICE_FEED === "mock"
      ? new MockPriceFeed()
      : new CachedFallbackFeed(new BinancePriceFeed(), new CoinGeckoPriceFeed());
  return cached;
}
