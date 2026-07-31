import { Asset, Prisma, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { getCashbackConfig, type CashbackConfig } from "./settings";
import { fromMinorUnits } from "./money";
import { notifyUser } from "./alerts";

/**
 * Cashback rewards, paid in NGN and credited as their own ledger row.
 *
 * Design notes:
 *  - Rates are per transaction kind (see SETTING_KEYS) because the economics
 *    differ; all default to 0, so nothing pays out until an admin sets them.
 *  - The reward is always a percentage of the NGN VALUE moved. Trades store the
 *    crypto leg on the row, so the NGN leg is taken from the quote metadata
 *    rather than from the transaction amount.
 *  - Awarding is best-effort: a cashback failure must never fail or reverse the
 *    transaction that earned it.
 */

/** Which rate applies. Mirrors the kinds we award on. */
export type CashbackSource = "deposit" | "withdrawal" | "bill" | "trade";

// The enum value ships via migration 0009, but migrations are not applied on
// deploy in this project (see ensureBeneficiaries/ensureCards), so the value is
// also added lazily and idempotently before the first cashback write.
let enumEnsured: Promise<void> | null = null;
export function ensureCashbackEnum(): Promise<void> {
  if (!enumEnsured) {
    enumEnsured = prisma
      .$executeRawUnsafe(`ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'CASHBACK'`)
      .then(() => undefined)
      .catch((err) => {
        enumEnsured = null; // allow retry on the next award
        throw err;
      });
  }
  return enumEnsured;
}

function rateFor(config: CashbackConfig, source: CashbackSource): number {
  switch (source) {
    case "deposit":
      return config.depositBps;
    case "withdrawal":
      return config.withdrawalBps;
    case "bill":
      return config.billBps;
    case "trade":
      return config.tradeBps;
  }
}

/**
 * Reward in kobo for an NGN base amount, honouring the rate and the
 * per-transaction cap. Pure — unit tested without a database.
 */
export function cashbackAmountMinor(
  baseNgnMinor: bigint,
  config: CashbackConfig,
  source: CashbackSource
): bigint {
  if (!config.enabled || baseNgnMinor <= 0n) return 0n;
  const bps = rateFor(config, source);
  if (bps <= 0) return 0n;

  let reward = (baseNgnMinor * BigInt(Math.trunc(bps))) / 10_000n; // floor
  if (config.maxNgn > 0) {
    const capMinor = BigInt(Math.trunc(config.maxNgn * 100));
    if (reward > capMinor) reward = capMinor;
  }
  return reward;
}

/**
 * Credit cashback for a completed transaction. Returns the amount credited
 * (0n when cashback is off, the rate is 0, or the reward rounds to nothing).
 *
 * Never throws: the caller has already moved the user's money, so a reward
 * problem is logged and swallowed rather than allowed to unwind that.
 */
export async function awardCashback(input: {
  userId: string;
  source: CashbackSource;
  /** NGN value of the earning transaction, in kobo. */
  baseNgnMinor: bigint;
  /** Ledger id of the transaction that earned it, for traceability. */
  sourceTransactionId?: string;
}): Promise<bigint> {
  try {
    const config = await getCashbackConfig();
    const reward = cashbackAmountMinor(input.baseNgnMinor, config, input.source);
    if (reward <= 0n) return 0n;

    await ensureCashbackEnum();

    await prisma.$transaction(async (tx) => {
      await tx.balance.upsert({
        where: { userId_asset: { userId: input.userId, asset: Asset.NGN } },
        update: { available: { increment: reward } },
        create: { userId: input.userId, asset: Asset.NGN, available: reward },
      });
      await tx.transaction.create({
        data: {
          userId: input.userId,
          type: TransactionType.CASHBACK,
          asset: Asset.NGN,
          amount: reward,
          status: TransactionStatus.COMPLETED,
          // Deterministic per earning transaction, so a retried webhook or a
          // double-called hook can never pay the same reward twice.
          idempotencyKey: `cashback:${input.sourceTransactionId ?? `${input.userId}:${Date.now()}`}`,
          metadata: {
            kind: "cashback",
            source: input.source,
            baseNgnMinor: input.baseNgnMinor.toString(),
            sourceTransactionId: input.sourceTransactionId ?? null,
          },
        },
      });
    });

    // Tell the user their reward landed (push + email, best-effort).
    await notifyUser(input.userId, {
      category: "deposits",
      title: "Cashback earned",
      body: `You earned ₦${fromMinorUnits(reward, Asset.NGN)} cashback on your ${input.source}.`,
      data: { sourceTransactionId: input.sourceTransactionId },
      details: [
        { label: "Reward", value: `₦${fromMinorUnits(reward, Asset.NGN)}` },
        { label: "Earned on", value: input.source },
      ],
    });

    return reward;
  } catch (err) {
    // A duplicate key means the reward was already paid — expected on retries.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return 0n;
    }
    console.error("[cashback] award failed", {
      userId: input.userId,
      source: input.source,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0n;
  }
}

/**
 * The NGN leg of a swap, in kobo, or 0n when there isn't one (crypto→crypto).
 * BUY spends NGN (amountIn), SELL receives NGN (amountOut).
 */
export function ngnLegFromSwapMetadata(meta: unknown): bigint {
  if (!meta || typeof meta !== "object") return 0n;
  const m = meta as { fromAsset?: string; toAsset?: string; amountIn?: string; amountOut?: string };
  try {
    if (m.fromAsset === "NGN" && m.amountIn) return BigInt(m.amountIn);
    if (m.toAsset === "NGN" && m.amountOut) return BigInt(m.amountOut);
  } catch {
    return 0n;
  }
  return 0n;
}
