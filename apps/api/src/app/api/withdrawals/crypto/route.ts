import {
  Asset,
  Network,
  Prisma,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { requireMfa, requireUser } from "@/lib/auth";
import { getCustodyProvider } from "@/custody";
import { isManualAsset } from "@/lib/manualCrypto";
import { getPriceFeed } from "@/market";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { isSupportedWallet } from "@/lib/assets";
import { getTierLimits, MAX_TIER } from "@/lib/kyc";
import { getEnv } from "@/lib/env";
import { toMinorUnits, fromMinorUnits } from "@/lib/money";
import { sendPush } from "@/lib/push";
import { cryptoToNgnKobo } from "@/lib/rates";
import { getUsdtNgnRate } from "@/lib/settings";
import {
  assertWithdrawalAllowed,
  sumTodayWithdrawalsNgnKobo,
  todayWithdrawalStats,
} from "@/lib/limits";
import { amlConfigFromEnv, assessWithdrawal } from "@/lib/aml";
import { enforceRateLimit } from "@/lib/ratelimit";
import { cryptoWithdrawalSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Crypto withdrawal to an external address. Money-safe + hardened:
 *   - MFA (AAL2) + rate limit + tier gate (tier ≥ 2)
 *   - NGN-valued single-tx + daily limits
 *   - AML: sanctioned address blocks; large/velocity holds for manual review
 *   - atomic debit (refuses overdraw); held funds are reserved (PENDING)
 *   - provider signs/broadcasts; refund + FAILED on provider error
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const relaxGuards = getEnv().RELAX_WITHDRAWAL_GUARDS;
    enforceRateLimit(`wd:crypto:${auth.id}`, 5, 60_000);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }

    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }
    // Require 2FA (AAL2) unless globally relaxed or the user opted into instant
    // withdrawal in their security settings.
    if (!relaxGuards && !user.instantWithdrawal) requireMfa(auth);
    if (!relaxGuards && !getTierLimits(user.kycTier).cryptoWithdrawalEnabled) {
      throw new ApiError(403, "Your KYC tier does not permit crypto withdrawals", "tier_blocked");
    }

    const body = cryptoWithdrawalSchema.parse(await req.json());
    const asset = body.asset as Asset;
    const network = body.network as Network;
    if (!isSupportedWallet(asset, network)) {
      throw new ApiError(422, `Unsupported asset/network: ${body.asset}/${body.network}`, "unsupported");
    }

    const amountMinor = toMinorUnits(body.amount, asset);

    const rate = await getUsdtNgnRate();
    if (rate === null) {
      throw new ApiError(503, "USDT→NGN rate not configured by admin", "no_rate");
    }
    const price = await getPriceFeed().getSpotUsdt(asset);
    const ngnValueKobo = cryptoToNgnKobo(amountMinor, asset, price, new Prisma.Decimal(rate));

    const usedToday = await sumTodayWithdrawalsNgnKobo(auth.id);
    const effectiveTier = relaxGuards ? MAX_TIER : user.kycTier;
    assertWithdrawalAllowed(effectiveTier, ngnValueKobo, usedToday);

    // AML screening.
    const stats = await todayWithdrawalStats(auth.id);
    const aml = assessWithdrawal(
      {
        ngnValueKobo,
        toAddress: body.toAddress,
        recentCount: stats.count,
        recentSumKobo: stats.sumKobo,
      },
      amlConfigFromEnv()
    );
    if (aml.blocked) {
      await prisma.auditLog.create({
        data: {
          userId: auth.id,
          action: "aml.withdrawal.blocked",
          resourceType: "User",
          resourceId: auth.id,
          details: { reasons: aml.reasons, toAddress: body.toAddress },
        },
      });
      throw new ApiError(403, "Withdrawal blocked by compliance screening", "aml_blocked");
    }

    // Idempotent replay.
    const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return jsonOk({ transactionId: existing.id, status: existing.status });
    }

    // Manual-custody assets always queue as PENDING: the business pays out
    // from its own wallet, then the admin marks the withdrawal complete.
    const manual = await isManualAsset(asset);

    // Atomic debit + record. Held-for-review withdrawals are PENDING (funds
    // reserved) and not broadcast until an admin approves.
    const initialStatus = aml.holdForReview || manual
      ? TransactionStatus.PENDING
      : TransactionStatus.PROCESSING;
    const tx = await prisma.$transaction(async (db) => {
      const debit = await db.balance.updateMany({
        where: { userId: auth.id, asset, available: { gte: amountMinor } },
        data: { available: { decrement: amountMinor } },
      });
      if (debit.count !== 1) {
        throw new ApiError(422, `Insufficient ${asset} balance`, "insufficient_funds");
      }
      return db.transaction.create({
        data: {
          userId: auth.id,
          type: TransactionType.WITHDRAWAL,
          asset,
          network,
          amount: amountMinor,
          status: initialStatus,
          idempotencyKey,
          metadata: {
            toAddress: body.toAddress,
            ngnValueKobo: ngnValueKobo.toString(),
            amlReview: aml.holdForReview,
            amlReasons: aml.reasons,
            manualPayout: manual,
          },
        },
      });
    });

    if (aml.holdForReview) {
      await prisma.auditLog.create({
        data: {
          userId: auth.id,
          action: "aml.withdrawal.held",
          resourceType: "Transaction",
          resourceId: tx.id,
          details: { reasons: aml.reasons, ngnValueKobo: ngnValueKobo.toString() },
        },
      });
      await sendPush(auth.id, {
        category: "security",
        title: "Withdrawal under review",
        body: `Your ${asset} withdrawal is being reviewed by our compliance team.`,
        data: { transactionId: tx.id },
      });
      return jsonOk({ transactionId: tx.id, status: "under_review", reasons: aml.reasons });
    }

    if (manual) {
      // Queue for the operations team; funds are already reserved.
      await prisma.auditLog.create({
        data: {
          userId: auth.id,
          action: "crypto.withdrawal.queued_manual",
          resourceType: "Transaction",
          resourceId: tx.id,
          details: { asset, network, amountMinor: amountMinor.toString(), toAddress: body.toAddress },
        },
      });
      await sendPush(auth.id, {
        category: "withdrawals",
        title: "Withdrawal processing",
        body: `Your ${fromMinorUnits(amountMinor, asset)} ${asset} withdrawal is being processed. You'll be notified when it's sent.`,
        data: { transactionId: tx.id },
      });
      return jsonOk({ transactionId: tx.id, status: "processing" });
    }

    // Provider signs + broadcasts; refund on failure.
    try {
      const custody = getCustodyProvider();
      const result = await custody.createWithdrawal({
        userId: auth.id,
        asset,
        network,
        toAddress: body.toAddress,
        amount: body.amount,
      });
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { txHash: result.txHash, externalRef: result.txHash },
      });
      await prisma.auditLog.create({
        data: {
          userId: auth.id,
          action: "crypto.withdrawal.broadcast",
          resourceType: "Transaction",
          resourceId: tx.id,
          details: { asset, network, amountMinor: amountMinor.toString(), txHash: result.txHash },
        },
      });
      await sendPush(auth.id, {
        category: "withdrawals",
        title: "Crypto withdrawal sent",
        body: `${fromMinorUnits(amountMinor, asset)} ${asset} is on its way to ${body.toAddress.slice(0, 8)}…`,
        data: { transactionId: tx.id, txHash: result.txHash },
      });
      return jsonOk({ transactionId: tx.id, status: "processing", txHash: result.txHash });
    } catch {
      await prisma.$transaction([
        prisma.balance.update({
          where: { userId_asset: { userId: auth.id, asset } },
          data: { available: { increment: amountMinor } },
        }),
        prisma.transaction.update({
          where: { id: tx.id },
          data: { status: TransactionStatus.FAILED },
        }),
      ]);
      throw new ApiError(502, "Withdrawal could not be broadcast; funds refunded", "broadcast_failed");
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
