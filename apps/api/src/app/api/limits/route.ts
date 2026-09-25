import { jsonOk, toErrorResponse } from "@/lib/http";
import {
  getDepositFeeBps,
  getBillMargins,
  getDepositMinUsd,
  getFxSideMarginBps,
  getPricing,
  getSwapSpreadBps,
  getWithdrawalFeeNgn,
  getWithdrawalMinNgn,
  getWithdrawalMinUsd,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Public: the minimums the apps display.
 *
 * The two withdrawal floors are enforced server-side as well — a client that
 * ignores them still gets a 422. `depositMinUsd` is advisory ONLY and is
 * enforced nowhere: an inbound transfer has already settled by the time we hear
 * about it, so the sole honest place for a deposit minimum is the screen the
 * user reads before sending. Refusing to credit what arrived would be keeping
 * their money, so the number is shown and every deposit is still credited in
 * full. `enforced` says as much to any client that cares to look.
 *
 * `fees` are the ones set in the admin dashboard, so the apps can show a fee
 * before the user commits rather than a number hard-coded into the screen. They
 * are the same values the server charges with; nothing here is advisory.
 *  - withdrawalFeeNgn: flat, taken out of the amount withdrawn (lib/fees.ts)
 *  - depositFeeBps:    share of each NGN deposit
 *  - swapSpreadBps:    crypto conversions
 *  - fx.*Bps:          NGN⇄USD, per direction (sellUsd = paying naira for dollars)
 *  - pricing:         the rest of the price sheet (deposit cap, USD deposit
 *                      tiers, crypto and card fees) — see Pricing in settings.ts
 *  - bills:           markup on bill payments, default + per service
 * Basis points: 100 = 1%.
 */
export async function GET() {
  try {
    const [
      depositMinUsd,
      withdrawalMinNgn,
      withdrawalMinUsd,
      withdrawalFeeNgn,
      depositFeeBps,
      swapSpreadBps,
      buyUsdBps,
      sellUsdBps,
      pricing,
      billMargins,
    ] = await Promise.all([
      getDepositMinUsd(),
      getWithdrawalMinNgn(),
      getWithdrawalMinUsd(),
      getWithdrawalFeeNgn(),
      getDepositFeeBps(),
      getSwapSpreadBps(),
      getFxSideMarginBps("buy_usd"),
      getFxSideMarginBps("sell_usd"),
      getPricing(),
      getBillMargins(),
    ]);
    const billBps = (s: keyof typeof billMargins.perService) =>
      billMargins.perService[s] ?? billMargins.defaultBps;
    return jsonOk({
      deposit: { minUsd: depositMinUsd, enforced: false },
      withdrawal: {
        minNgn: withdrawalMinNgn,
        minUsd: withdrawalMinUsd,
        enforced: true,
      },
      fees: {
        withdrawalFeeNgn,
        depositFeeBps,
        swapSpreadBps,
        fx: { buyUsdBps, sellUsdBps },
        ...pricing,
        bills: {
          airtime: billBps("airtime"),
          data: billBps("data"),
          electricity: billBps("electricity"),
          cabletv: billBps("cabletv"),
          betting: billBps("betting"),
          food: billBps("food"),
        },
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
