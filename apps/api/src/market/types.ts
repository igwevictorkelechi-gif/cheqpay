import type { Asset, Prisma } from "@cheqpay/db";

export type ChartRange = "day" | "week" | "month" | "year" | "all";

export const CHART_RANGES: ChartRange[] = ["day", "week", "month", "year", "all"];

export interface Candle {
  time: number; // unix ms
  open: string;
  high: string;
  low: string;
  close: string;
}

/**
 * Read-only crypto market data for the asset detail page. This is the DISPLAY
 * feed — informational only. Execution prices come from the quote engine.
 */
export interface PriceFeed {
  readonly name: string;
  /** USDT per 1 unit of the asset (USDT itself = 1). */
  getSpotUsdt(asset: Asset): Promise<Prisma.Decimal>;
  /** Candle series for the requested range. */
  getCandles(asset: Asset, range: ChartRange): Promise<Candle[]>;
}
