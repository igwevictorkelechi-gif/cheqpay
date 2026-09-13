import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { platformSettingsUpdateSchema } from "@/lib/validation";
import {
  getBillMargins,
  getCashbackConfig,
  getDepositFeeBps,
  getFxMarginBps,
  getSwapSpreadBps,
  getUsdtNgnRate,
  getWithdrawalFeeNgn,
  setBillMarginBps,
  setBillMarginForService,
  setCashbackConfig,
  setDepositFeeBps,
  setFxMarginBps,
  setSwapSpreadBps,
  setUsdtNgnRate,
  setWithdrawalFeeNgn,
  type BillMarginService,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

async function snapshot() {
  const [spreadBps, usdtNgnRate, depositFeeBps, withdrawalFeeNgn, fxMarginBps, billMargins, cashback] =
    await Promise.all([
      getSwapSpreadBps(),
      getUsdtNgnRate(),
      getDepositFeeBps(),
      getWithdrawalFeeNgn(),
      getFxMarginBps(),
      getBillMargins(),
      getCashbackConfig(),
    ]);
  return {
    spreadBps,
    usdtNgnRate,
    depositFeeBps,
    withdrawalFeeNgn,
    fxMarginBps,
    billMarginBps: billMargins.defaultBps,
    /** Per service: a number overrides the default, null means it uses it. */
    billMargins: billMargins.perService,
    cashbackEnabled: cashback.enabled,
    cashbackDepositBps: cashback.depositBps,
    cashbackWithdrawalBps: cashback.withdrawalBps,
    cashbackBillBps: cashback.billBps,
    cashbackTradeBps: cashback.tradeBps,
    cashbackMaxNgn: cashback.maxNgn,
  };
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
    if (body.fxMarginBps !== undefined) await setFxMarginBps(body.fxMarginBps, updatedBy);
    if (body.billMargins) {
      // An omitted service is left alone; null clears its override.
      for (const [service, bps] of Object.entries(body.billMargins)) {
        if (bps === undefined) continue;
        await setBillMarginForService(service as BillMarginService, bps, updatedBy);
      }
    }

    await setCashbackConfig(
      {
        enabled: body.cashbackEnabled,
        depositBps: body.cashbackDepositBps,
        withdrawalBps: body.cashbackWithdrawalBps,
        billBps: body.cashbackBillBps,
        tradeBps: body.cashbackTradeBps,
        maxNgn: body.cashbackMaxNgn,
      },
      updatedBy
    );

    return jsonOk(await snapshot());
  } catch (err) {
    return toErrorResponse(err);
  }
}
