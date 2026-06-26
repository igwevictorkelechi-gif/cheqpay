import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { ApiError } from "./http";
import { isWithinSingleTxLimit, remainingDailyWithdrawal } from "./kyc";

/**
 * Pure check: throws if a withdrawal of `amountKobo` is not allowed for the
 * tier given the amount already withdrawn today. Unit-tested without a DB.
 */
export function assertWithdrawalAllowed(
  tier: number,
  amountKobo: bigint,
  usedTodayKobo: bigint
): void {
  if (amountKobo <= 0n) {
    throw new ApiError(422, "Amount must be positive", "bad_amount");
  }
  if (!isWithinSingleTxLimit(tier, amountKobo)) {
    throw new ApiError(403, "Amount exceeds your per-transaction limit", "single_tx_limit");
  }
  const remaining = remainingDailyWithdrawal(tier, usedTodayKobo);
  if (amountKobo > remaining) {
    throw new ApiError(403, "Amount exceeds your remaining daily limit", "daily_limit");
  }
}

/** Sum of today's NGN withdrawals that still count against the daily cap. */
export async function sumTodayNgnWithdrawalsKobo(userId: string): Promise<bigint> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      asset: Asset.NGN,
      type: TransactionType.WITHDRAWAL,
      status: {
        in: [
          TransactionStatus.PENDING,
          TransactionStatus.PROCESSING,
          TransactionStatus.COMPLETED,
        ],
      },
      createdAt: { gte: start },
    },
    select: { amount: true },
  });
  return rows.reduce((sum, r) => sum + r.amount, 0n);
}
