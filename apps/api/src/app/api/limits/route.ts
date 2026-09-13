import { jsonOk, toErrorResponse } from "@/lib/http";
import {
  getDepositMinUsd,
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
 */
export async function GET() {
  try {
    const [depositMinUsd, withdrawalMinNgn, withdrawalMinUsd] = await Promise.all([
      getDepositMinUsd(),
      getWithdrawalMinNgn(),
      getWithdrawalMinUsd(),
    ]);
    return jsonOk({
      deposit: { minUsd: depositMinUsd, enforced: false },
      withdrawal: {
        minNgn: withdrawalMinNgn,
        minUsd: withdrawalMinUsd,
        enforced: true,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
