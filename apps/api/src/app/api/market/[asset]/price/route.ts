import { Asset } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getUsdtNgnRate } from "@/lib/settings";
import { getPriceFeed } from "@/market";

export const dynamic = "force-dynamic";

const SUPPORTED = new Set<string>([Asset.BTC, Asset.USDT, Asset.USDC]);

/** Live display price for the asset page (USD via USDT, plus NGN at the business rate). */
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

    const spotUsdt = await getPriceFeed().getSpotUsdt(asset as Asset);
    const rate = await getUsdtNgnRate();
    const priceNgn = rate !== null ? spotUsdt.mul(rate).toFixed(2) : null;

    return jsonOk({
      asset,
      priceUsd: spotUsdt.toString(),
      priceNgn,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
