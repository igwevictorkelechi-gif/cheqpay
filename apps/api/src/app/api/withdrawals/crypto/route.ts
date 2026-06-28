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
import { getPriceFeed } from "@/market";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { isSupportedWallet } from "@/lib/assets";
import { getTierLimits } from "@/lib/kyc";
import { toMinorUnits } from "@/lib/money";
import { cryptoToNgnKobo } from "@/lib/rates";
import { getUsdtNgnRate } from "@/lib/settings";
import { assertWithdrawalAllowed, sumTodayWithdrawalsNgnKobo } from "@/lib/limits";
import { cryptoWithdrawalSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Crypto withdrawal to an external address. Requirements (money-safe):
 *   - MFA (Supabase AAL2)
 *   - tier permits crypto withdrawals (tier ≥ 2)
 *   - NGN-valued single-tx + daily limits
 *   - atomic debit (refuses overdraw) + PROCESSING record
 *   - provider signs/broadcasts; refund + FAILED on provider error
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    requireMfa(auth);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }

    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }
    if (!getTierLimits(user.kycTier).cryptoWithdrawalEnabled) {
      throw new ApiError(403, "Your KYC tier does not permit crypto withdrawals", "tier_blocked");
    }

    const body = cryptoWithdrawalSchema.parse(await req.json());
    const asset = body.asset as Asset;
    const network = body.network as Network;
    if (!isSupportedWallet(asset, network)) {
      throw new ApiError(422, `Unsupported asset/network: ${body.asset}/${body.network}`, "unsupported");
    }

    const amountMinor = toMinorUnits(body.amount, asset);

    // Value the withdrawal in NGN to enforce NGN-denominated limits.
    const rate = await getUsdtNgnRate();
    if (rate === null) {
      throw new ApiError(503, "USDT→NGN rate not configured by admin", "no_rate");
    }
    const price = await getPriceFeed().getSpotUsdt(asset);
    const ngnValueKobo = cryptoToNgnKobo(amountMinor, asset, price, new Prisma.Decimal(rate));

    const usedToday = await sumTodayWithdrawalsNgnKobo(auth.id);
    assertWithdrawalAllowed(user.kycTier, ngnValueKobo, usedToday);

    // Idempotent replay.
    const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return jsonOk({ transactionId: existing.id, status: existing.status });
    }

    // Atomic debit + PROCESSING record.
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
          status: TransactionStatus.PROCESSING,
          idempotencyKey,
          metadata: {
            toAddress: body.toAddress,
            ngnValueKobo: ngnValueKobo.toString(),
          },
        },
      });
    });

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
          details: {
            asset,
            network,
            amountMinor: amountMinor.toString(),
            ngnValueKobo: ngnValueKobo.toString(),
            txHash: result.txHash,
          },
        },
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
