import { describe, expect, it } from "vitest";
import { Asset } from "@cheqpay/db";
import { parseKlines, parseTicker } from "./binance";
import { parseMarketChart, parseSimplePrice } from "./coingecko";
import { MockPriceFeed } from "./mock";

describe("Binance parsers", () => {
  it("parses a ticker price", () => {
    expect(parseTicker({ symbol: "BTCUSDT", price: "60123.45" }).toString()).toBe("60123.45");
    expect(() => parseTicker({})).toThrow();
  });

  it("parses klines into candles", () => {
    const candles = parseKlines([
      [1700000000000, "60000", "61000", "59000", "60500", "12.3"],
    ]);
    expect(candles[0]).toMatchObject({
      time: 1700000000000,
      open: "60000",
      high: "61000",
      low: "59000",
      close: "60500",
    });
    expect(() => parseKlines({} as unknown)).toThrow();
  });
});

describe("CoinGecko parsers", () => {
  it("parses simple price", () => {
    expect(parseSimplePrice({ bitcoin: { usd: 60000 } }, "bitcoin").toString()).toBe("60000");
    expect(() => parseSimplePrice({}, "bitcoin")).toThrow();
  });

  it("parses market chart points into flat candles", () => {
    const candles = parseMarketChart({ prices: [[1700000000000, 60000]] });
    expect(candles[0]).toMatchObject({ time: 1700000000000, close: "60000" });
  });
});

describe("MockPriceFeed", () => {
  it("returns deterministic spot prices", async () => {
    const feed = new MockPriceFeed();
    expect((await feed.getSpotUsdt(Asset.USDT)).toString()).toBe("1");
    expect((await feed.getSpotUsdt(Asset.BTC)).toString()).toBe("60000");
  });

  it("returns candles for BTC and none for USDT", async () => {
    const feed = new MockPriceFeed();
    expect((await feed.getCandles(Asset.BTC, "day")).length).toBeGreaterThan(0);
    expect(await feed.getCandles(Asset.USDT, "day")).toEqual([]);
  });
});
