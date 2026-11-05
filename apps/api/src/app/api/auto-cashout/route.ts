import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getFeatureFlags } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { autoCashoutSettingsSchema } from "@/lib/validation";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { getWithdrawalFeeNgn, getWithdrawalMinNgn } from "@/lib/settings";
import { getAutoCashoutSettings, listAutoCashouts, saveAutoCashoutSettings } from "@/lib/autoCashout";
import { maskedAccount } from "@/lib/autoCashout/rules";
import { notifyUser } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/**
 * Auto cash-out: each USDT, USDC or BTC deposit sold for naira and paid to the
 * user's own bank account (lib/autoCashout).
 *
 * GET  — the user's settings, the rules that apply, and recent runs.
 * PUT  — change them. Turning it on, or changing what it sells or where it
 *        pays, needs the transaction PIN: it authorises payouts that will
 *        later happen without a tap. Turning it off never does.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const flags = await getFeatureFlags();
    const [settings, runs, minNgn, feeNgn] = await Promise.all([
      getAutoCashoutSettings(auth.id),
      listAutoCashouts(auth.id),
      getWithdrawalMinNgn(),
      getWithdrawalFeeNgn(),
    ]);
    const ben = settings.beneficiaryId
      ? await prisma.beneficiary.findFirst({
          where: { id: settings.beneficiaryId, userId: auth.id },
          select: { id: true, bankName: true, accountNumber: true, accountName: true },
        })
      : null;
    return jsonOk({
      available: flags.auto_cashout,
      enabled: flags.auto_cashout && settings.enabled,
      assets: settings.assets,
      beneficiary: ben
        ? { id: ben.id, bankName: ben.bankName, accountName: ben.accountName, label: maskedAccount(ben.bankName, ben.accountNumber) }
        : null,
      minPayoutNgn: minNgn,
      payoutFeeNgn: feeNgn,
      runs,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireUser(req);
    await enforceRateLimit(`autocash:set:${auth.id}`, 10, 60_000);
    const body = autoCashoutSettingsSchema.parse(await req.json());
    let widened = false;

    if (body.enabled) {
      const flags = await getFeatureFlags();
      if (!flags.auto_cashout) {
        throw new ApiError(503, "Auto cash-out isn't available right now.", "feature_disabled");
      }
      // Only one of the user's own saved accounts — each was checked against
      // their verified name when it was saved, and is checked again at payout.
      const ben = await prisma.beneficiary.findFirst({
        where: { id: body.beneficiaryId as string, userId: auth.id },
        select: { id: true },
      });
      if (!ben) throw new ApiError(404, "Choose one of your saved bank accounts.", "no_beneficiary");

      const current = await getAutoCashoutSettings(auth.id);
      const widens =
        !current.enabled ||
        current.beneficiaryId !== body.beneficiaryId ||
        body.assets.some((a) => !current.assets.includes(a));
      if (widens) await requireTransactionPin(auth.id, readPin(req));
      widened = widens;
    }

    await saveAutoCashoutSettings(auth.id, {
      enabled: body.enabled,
      assets: [...new Set(body.assets)],
      beneficiaryId: body.beneficiaryId,
    });
    // Tell the owner whenever payouts are authorised or redirected, so a change
    // they didn't make is noticed straight away.
    if (widened) {
      const ben = await prisma.beneficiary.findFirst({
        where: { id: body.beneficiaryId as string, userId: auth.id },
        select: { bankName: true, accountNumber: true },
      });
      await notifyUser(auth.id, {
        category: "security",
        title: "Auto cash-out is on",
        body: `${body.assets.join(", ")} you receive will be sold and paid to ${
          ben ? maskedAccount(ben.bankName, ben.accountNumber) : "your bank account"
        }. If this wasn't you, turn it off and change your transaction PIN.`,
        data: {},
      }).catch(() => undefined);
    }
    await prisma.auditLog
      .create({
        data: {
          userId: auth.id,
          action: body.enabled ? "auto_cashout.enabled" : "auto_cashout.disabled",
          resourceType: "AutoCashout",
          resourceId: auth.id,
          details: { assets: body.assets, beneficiaryId: body.beneficiaryId },
        },
      })
      .catch(() => undefined);
    return jsonOk({ ok: true, enabled: body.enabled, assets: body.assets, beneficiaryId: body.beneficiaryId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
