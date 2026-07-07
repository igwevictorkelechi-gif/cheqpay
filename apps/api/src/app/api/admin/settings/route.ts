import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { platformSettingsUpdateSchema } from "@/lib/validation";
import {
  getBillMarginBps,
  getDepositFeeBps,
  getSwapSpreadBps,
  getUsdtNgnRate,
  getWithdrawalFeeNgn,
  setBillMarginBps,
  setDepositFeeBps,
  setSwapSpreadBps,
  setUsdtNgnRate,
  setWithdrawalFeeNgn,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

async function snapshot() {
  const [spreadBps, usdtNgnRate, depositFeeBps, withdrawalFeeNgn, billMarginBps] =
    await Promise.all([
      getSwapSpreadBps(),
      getUsdtNgnRate(),
      getDepositFeeBps(),
      getWithdrawalFeeNgn(),
      getBillMarginBps(),
    ]);
  return { spreadBps, usdtNgnRate, depositFeeBps, withdrawalFeeNgn, billMarginBps };
}

/** Admin: read the business-controlled rates, spreads and fees. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    return jsonOk(await snapshot());
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: set the spread, USDT->NGN rate, and/or business fees. */
export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const updatedBy = req.headers.get("x-admin-actor") ?? "admin";
    const body = platformSettingsUpdateSchema.parse(await req.json());

    if (body.spreadBps !== undefined) await setSwapSpreadBps(body.spreadBps, updatedBy);
    if (body.usdtNgnRate !== undefined) await setUsdtNgnRate(body.usdtNgnRate, updatedBy);
    if (body.depositFeeBps !== undefined) await setDepositFeeBps(body.depositFeeBps, updatedBy);
    if (body.withdrawalFeeNgn !== undefined)
      await setWithdrawalFeeNgn(body.withdrawalFeeNgn, updatedBy);
    if (body.billMarginBps !== undefined) await setBillMarginBps(body.billMarginBps, updatedBy);

    return jsonOk(await snapshot());
  } catch (err) {
    return toErrorResponse(err);
  }
}
