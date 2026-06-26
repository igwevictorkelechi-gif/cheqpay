import { Asset } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { CHART_RANGES, type ChartRange, getPriceFeed } from "@/market";

export const dynamic = "force-dynamic";

const SUPPORTED = new Set<string>([Asset.BTC, Asset.USDT]);

/** Candle series for the asset page chart (Day / Week / Month / Year / All). */
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

    const rangeParam = new URL(req.url).searchParams.get("range") ?? "day";
    if (!CHART_RANGES.includes(rangeParam as ChartRange)) {
      throw new ApiError(422, `Invalid range: ${rangeParam}`, "bad_range");
    }

    const candles = await getPriceFeed().getCandles(asset as Asset, rangeParam as ChartRange);
    return jsonOk({ asset, range: rangeParam, candles });
  } catch (err) {
    return toErrorResponse(err);
  }
}
