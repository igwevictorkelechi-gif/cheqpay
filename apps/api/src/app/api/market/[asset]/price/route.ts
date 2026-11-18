import { Asset, Prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getDollarBook, getSwapSpreadBpsFor, getTradeMarginNgnPerUsd } from "@/lib/settings";
import { getPriceFeed } from "@/market";

export const dynamic = "force-dynamic";

const SUPPORTED = new Set<string>([Asset.BTC, Asset.USDT, Asset.USDC]);

/**
 * The asset page's prices.
 *
 *  - `priceNgn`: the market price — the coin's dollar price at the middle of
 *    Maplerad's naira ⇄ dollar book. What the coin is worth, not what we
 *    trade it at.
 *  - `buyNgn` / `sellNgn`: what one coin costs from us and fetches from us:
 *    Maplerad's own rate for that side, plus or minus our ₦ per $1 margin.
 *    These are indicative; the quote on the trade sheet is the exact figure,
 *    priced live for the amount.
 *  - `dollar`: the same three, per $1, for the "conversion rate" line.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ asset: string }> }
) {
  try {
    await requireUser(req);
    const { asset: raw } = await params;
    const asset = raw.toUpperCase();
    if (!SUPPORTED.has(asset)) {
      throw new ApiError(404, `Unsupported asset: ${raw}`, "unsupported_asset");
    }

    // Display only, so don't hold the screen on Maplerad: take the stored
    // rates now and let the refresh land behind the response.
    const [spotUsdt, book, perUsd] = await Promise.all([
      getPriceFeed().getSpotUsdt(asset as Asset),
      getDollarBook({ wait: false }),
      getTradeMarginNgnPerUsd(),
    ]);

    let dollar: { market: number; buy: number; sell: number } | null = null;
    if (book.bid !== null && book.ask !== null && book.mid !== null) {
      if (perUsd > 0) {
        dollar = { market: book.mid, buy: book.ask + perUsd, sell: book.bid - perUsd };
      } else {
        // Percentage mode: the admin spreads around the one rate.
        const [buyBps, sellBps] = await Promise.all([getSwapSpreadBpsFor("buy"), getSwapSpreadBpsFor("sell")]);
        dollar = {
          market: book.mid,
          buy: book.ask * (1 + buyBps / 10_000),
          sell: book.bid * (1 - sellBps / 10_000),
        };
      }
    }
    const perCoin = (ngnPerUsd: number) => spotUsdt.mul(new Prisma.Decimal(ngnPerUsd)).toFixed(2);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return jsonOk({
      asset,
      priceUsd: spotUsdt.toString(),
      priceNgn: dollar ? perCoin(dollar.market) : null,
      buyNgn: dollar ? perCoin(dollar.buy) : null,
      sellNgn: dollar ? perCoin(dollar.sell) : null,
      dollar: dollar
        ? {
            marketNgn: round2(dollar.market),
            buyNgn: round2(dollar.buy),
            sellNgn: round2(dollar.sell),
            marginNgn: perUsd,
            source: book.source,
          }
        : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
