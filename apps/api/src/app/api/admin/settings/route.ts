import { requireAdmin } from "@/lib/auth";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { platformSettingsUpdateSchema } from "@/lib/validation";
import {
  getBillMargins,
  getCashbackConfig,
  getDepositFeeBps,
  getDepositMinUsd,
  getFxMarginBps,
  getFxMargins,
  getSwapSpreadBps,
  getUsdtNgnRate,
  getWithdrawalFeeNgn,
  getWithdrawalMinNgn,
  getWithdrawalMinUsd,
  setBillMarginBps,
  setBillMarginForService,
  setCashbackConfig,
  setDepositFeeBps,
  setDepositMinUsd,
  setFxMarginBps,
  setFxSideMarginBps,
  setSwapSpreadBps,
  setUsdtNgnRate,
  setWithdrawalFeeNgn,
  setWithdrawalMinNgn,
  setWithdrawalMinUsd,
  type BillMarginService,
  type FxSide,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

async function snapshot() {
  const [
    spreadBps,
    usdtNgnRate,
    depositFeeBps,
    withdrawalFeeNgn,
    fxMarginBps,
    fxMargins,
    billMargins,
    withdrawalMinNgn,
    withdrawalMinUsd,
    depositMinUsd,
    cashback,
  ] = await Promise.all([
    getSwapSpreadBps(),
    getUsdtNgnRate(),
    getDepositFeeBps(),
    getWithdrawalFeeNgn(),
    getFxMarginBps(),
    getFxMargins(),
    getBillMargins(),
    getWithdrawalMinNgn(),
    getWithdrawalMinUsd(),
    getDepositMinUsd(),
    getCashbackConfig(),
  ]);
  return {
    spreadBps,
    usdtNgnRate,
    depositFeeBps,
    withdrawalFeeNgn,
    fxMarginBps,
    /** Per side: a number overrides the shared spread, null means it uses it. */
    fxMargins: { buyUsd: fxMargins.buyUsdBps, sellUsd: fxMargins.sellUsdBps },
    withdrawalMinNgn,
    withdrawalMinUsd,
    depositMinUsd,
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
    // Rates, margins, fees and minimums decide how much money every customer
    // transaction moves. A bad USDT/NGN rate drains the platform through swaps
    // as surely as a fake credit, so this is guarded the same way.
    const actorInfo = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const updatedBy = actorInfo.email;
    const body = platformSettingsUpdateSchema.parse(await req.json());

    if (body.spreadBps !== undefined) await setSwapSpreadBps(body.spreadBps, updatedBy);
    if (body.usdtNgnRate !== undefined) await setUsdtNgnRate(body.usdtNgnRate, updatedBy);
    if (body.depositFeeBps !== undefined) await setDepositFeeBps(body.depositFeeBps, updatedBy);
    if (body.withdrawalFeeNgn !== undefined)
      await setWithdrawalFeeNgn(body.withdrawalFeeNgn, updatedBy);
    if (body.billMarginBps !== undefined) await setBillMarginBps(body.billMarginBps, updatedBy);
    if (body.fxMarginBps !== undefined) await setFxMarginBps(body.fxMarginBps, updatedBy);
    if (body.withdrawalMinNgn !== undefined)
      await setWithdrawalMinNgn(body.withdrawalMinNgn, updatedBy);
    if (body.withdrawalMinUsd !== undefined)
      await setWithdrawalMinUsd(body.withdrawalMinUsd, updatedBy);
    if (body.depositMinUsd !== undefined) await setDepositMinUsd(body.depositMinUsd, updatedBy);
    if (body.fxMargins) {
      // An omitted side is left alone; null clears its override.
      for (const [side, bps] of Object.entries(body.fxMargins)) {
        if (bps === undefined) continue;
        const key = side === "buyUsd" ? "buy_usd" : "sell_usd";
        await setFxSideMarginBps(key as FxSide, bps, updatedBy);
      }
    }
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

    const changed = Object.entries(body)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    await recordAdminAction(req, actorInfo, {
      action: "admin.settings.updated",
      summary: `Pricing/limits settings changed: ${changed.join(", ") || "(none)"}`,
      resourceType: "PlatformSetting",
      details: { changed: body as Record<string, unknown> },
    });

    return jsonOk(await snapshot());
  } catch (err) {
    return toErrorResponse(err);
  }
}
