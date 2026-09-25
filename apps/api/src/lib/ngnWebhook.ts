import {
  Asset,
  Network,
  Prisma,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import type { NgnChargeEvent } from "@/payments/types";
import { creditBalance } from "@/lib/ledger";
import { toMinorUnits, fromMinorUnits } from "@/lib/money";
import { notifyUser } from "@/lib/alerts";
import { feeFromBps, getDepositFeeBps } from "@/lib/settings";
import { awardCashback } from "@/lib/cashback";

/**
 * NGN settlement — the money changes an inbound payment webhook applies:
 * idempotency gate -> atomic ledger update -> push notification.
 *
 * Provider-agnostic on purpose: signature verification and event parsing differ
 * per PSP (Maplerad signs with Svix) and live in the provider's own route, which
 * then calls into these functions to move the money.
 */

/** The shape every finalize* function returns; `notifySettlement` reads it. */
export interface SettlementResult {
  status: string;
  transactionId?: string;
  userId?: string;
  amountMinor?: string;
}

/**
 * Record an event before acting on it. Returns false when this event was
 * already seen, so the caller can no-op instead of double-crediting a replay.
 */
export async function claimWebhookEvent(
  source: string,
  eventId: string,
  payload: unknown
): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: {
        source,
        eventId,
        payload: payload as Prisma.InputJsonValue,
        signatureValid: true,
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return false; // already handled
    }
    throw err;
  }
}

/**
 * Undo a claim whose handler failed before finishing.
 *
 * The claim row is written BEFORE the work, so a handler that throws midway
 * would otherwise leave a row that makes the provider's retry look like a
 * duplicate — and a deposit that really arrived would never be credited.
 * Dropping the unprocessed row lets the retry do the work for real; every
 * credit path is idempotent on its own key, so re-running is safe even when the
 * failure happened after the money was already booked.
 *
 * Only unprocessed rows are removed, so a completed delivery keeps its record.
 */
export async function releaseWebhookEvent(source: string, eventId: string): Promise<void> {
  try {
    await prisma.webhookEvent.deleteMany({
      where: { source, eventId, processedAt: null },
    });
  } catch (err) {
    // Best-effort: the retry would dedupe, which is bad, but throwing here
    // would mask the original handler error, which is worse.
    console.error("[webhook] failed to release claim", { source, eventId, err });
  }
}

/** Tell the user their money moved. Best-effort — never blocks settlement. */
export async function notifySettlement(result: SettlementResult): Promise<void> {
  if (!result.userId) return;
  const naira = () => fromMinorUnits(BigInt(result.amountMinor!), Asset.NGN);

  if (result.status === "credited") {
    await notifyUser(result.userId, {
      category: "deposits",
      title: "Deposit received",
      body: `₦${naira()} has landed in your CheqPay wallet.`,
      data: { transactionId: result.transactionId },
    });
  } else if (result.status === "reversed") {
    await notifyUser(result.userId, {
      category: "withdrawals",
      title: "Withdrawal reversed",
      body: `Your payout of ₦${naira()} failed and was refunded.`,
      data: { transactionId: result.transactionId },
    });
  } else if (result.status === "completed") {
    await notifyUser(result.userId, {
      category: "withdrawals",
      title: "Withdrawal sent",
      body: "Your payout was completed successfully.",
      data: { transactionId: result.transactionId },
    });
  }
}

export function markProcessed(source: string, eventId: string) {
  return prisma.webhookEvent.update({
    where: { source_eventId: { source, eventId } },
    data: { processedAt: new Date() },
  });
}

/** Credit a PENDING deposit on a successful charge (atomic + idempotent). */
export async function finalizeDeposit(
  txRef: string,
  amount: string,
  status: "successful" | "failed" | "pending"
) {
  const result = await prisma.$transaction(async (tx) => {
    const dep = await tx.transaction.findFirst({
      where: { externalRef: txRef, type: TransactionType.DEPOSIT, asset: Asset.NGN },
    });
    if (!dep) return { status: "unmatched" as const };
    if (dep.status === TransactionStatus.COMPLETED) {
      return { status: "already_credited" as const, transactionId: dep.id };
    }
    if (status !== "successful") {
      await tx.transaction.update({
        where: { id: dep.id },
        data: { status: TransactionStatus.FAILED },
      });
      return { status: "charge_failed" as const, transactionId: dep.id };
    }

    const amountMinor = toMinorUnits(amount, Asset.NGN);
    // Business deposit fee (admin-set, default 0): credit net, record gross+fee.
    const feeMinor = feeFromBps(amountMinor, await getDepositFeeBps());
    const netMinor = amountMinor - feeMinor;
    await tx.balance.upsert({
      where: { userId_asset: { userId: dep.userId, asset: Asset.NGN } },
      update: { available: { increment: netMinor } },
      create: { userId: dep.userId, asset: Asset.NGN, available: netMinor },
    });
    await tx.transaction.update({
      where: { id: dep.id },
      data: { status: TransactionStatus.COMPLETED, amount: amountMinor, fee: feeMinor },
    });
    await tx.auditLog.create({
      data: {
        userId: dep.userId,
        action: "ngn.deposit.credited",
        resourceType: "Transaction",
        resourceId: dep.id,
        details: { amountMinor: amountMinor.toString(), feeMinor: feeMinor.toString(), txRef },
      },
    });
    return {
      status: "credited" as const,
      transactionId: dep.id,
      userId: dep.userId,
      // Net figure — used for the "landed in your wallet" notification.
      amountMinor: netMinor.toString(),
      // Gross figure — cashback is earned on what the user actually paid in.
      grossMinor: amountMinor.toString(),
    };
  });

  // Cashback runs after the credit commits: it opens its own transaction, and
  // a reward problem must never unwind a deposit that already landed.
  if (result.status === "credited") {
    await awardCashback({
      userId: result.userId,
      source: "deposit",
      baseNgnMinor: BigInt(result.grossMinor),
      sourceTransactionId: result.transactionId,
    });
  }
  return result;
}

/** Complete or reverse a PROCESSING withdrawal based on the payout result. */
export async function finalizeWithdrawal(
  reference: string,
  status: "successful" | "failed" | "pending"
) {
  const result = await prisma.$transaction(async (tx) => {
    const wd = await tx.transaction.findFirst({
      where: { id: reference, type: TransactionType.WITHDRAWAL, asset: Asset.NGN },
    });
    if (!wd) return { status: "unmatched" as const };
    // FAILED is final too: the route already refunded a payout the provider
    // rejected outright, so a late webhook must not refund it a second time.
    if (
      wd.status === TransactionStatus.COMPLETED ||
      wd.status === TransactionStatus.REVERSED ||
      wd.status === TransactionStatus.FAILED
    ) {
      if (wd.status === TransactionStatus.FAILED && status === "successful") {
        // Refunded AND paid out: the provider contradicted its own rejection.
        // Nothing automatic is safe here — flag it loudly for a human.
        console.error("[ngn withdrawal] provider paid a payout we refunded — recover by hand", {
          transactionId: wd.id,
          userId: wd.userId,
        });
      }
      return { status: "already_final" as const, transactionId: wd.id };
    }

    // Claim the row: only one webhook (or retry) may move it out of flight.
    // Two events racing for the same reference both reach here, but only one
    // of them flips the status, and only that one may touch the balance.
    const claim = async (to: TransactionStatus) =>
      (
        await tx.transaction.updateMany({
          where: {
            id: wd.id,
            status: { in: [TransactionStatus.PROCESSING, TransactionStatus.PENDING] },
          },
          data: { status: to },
        })
      ).count === 1;

    if (status === "successful") {
      if (!(await claim(TransactionStatus.COMPLETED))) {
        return { status: "already_final" as const, transactionId: wd.id };
      }
      return {
        status: "completed" as const,
        transactionId: wd.id,
        userId: wd.userId,
        amountMinor: wd.amount.toString(),
      };
    }

    if (status === "failed") {
      if (!(await claim(TransactionStatus.REVERSED))) {
        return { status: "already_final" as const, transactionId: wd.id };
      }
      // Refund the debited funds (amount + any fee).
      await tx.balance.update({
        where: { userId_asset: { userId: wd.userId, asset: Asset.NGN } },
        data: { available: { increment: wd.amount + wd.fee } },
      });
      await tx.auditLog.create({
        data: {
          userId: wd.userId,
          action: "ngn.withdrawal.reversed",
          resourceType: "Transaction",
          resourceId: wd.id,
          details: { amountMinor: wd.amount.toString(), reason: "payout_failed" },
        },
      });
      return {
        status: "reversed" as const,
        transactionId: wd.id,
        userId: wd.userId,
        amountMinor: wd.amount.toString(),
      };
    }

    return { status: "pending" as const, transactionId: wd.id };
  });

  // Only a payout that actually landed earns cashback — never a reversal.
  if (result.status === "completed") {
    await awardCashback({
      userId: result.userId,
      source: "withdrawal",
      baseNgnMinor: BigInt(result.amountMinor),
      sourceTransactionId: result.transactionId,
    });
  }
  return result;
}

/**
 * Credit a successful charge that arrived via the user's STATIC virtual
 * account. Resolution order:
 *   1. the VA tx_ref we minted at creation embeds the owner ("va_<userId>_<ts>")
 *   2. otherwise the charge's customer email, but only when that user actually
 *      owns an NGN virtual account (conservative — we never guess with money)
 * The credit is idempotent on the provider event id, so replays can't double-credit.
 */
export async function creditStaticVaDeposit(source: string, charge: NgnChargeEvent) {
  if (charge.currency.toUpperCase() !== "NGN") {
    return { status: "unmatched" as const };
  }

  // 1) Owner embedded in the VA's tx_ref.
  let userId: string | null = null;
  const m = /^va_([0-9a-f-]{36})_/i.exec(charge.txRef);
  if (m) {
    const user = await prisma.user.findUnique({ where: { id: m[1] } });
    if (user) userId = user.id;
  }

  // 2) Fall back to the customer email, requiring VA ownership.
  if (!userId && charge.customerEmail) {
    const user = await prisma.user.findUnique({
      where: { email: charge.customerEmail },
    });
    if (user) {
      const va = await prisma.wallet.findUnique({
        where: {
          userId_asset_network: {
            userId: user.id,
            asset: Asset.NGN,
            network: Network.FIAT,
          },
        },
      });
      if (va) userId = user.id;
    }
  }

  if (!userId) return { status: "unmatched" as const };

  const amountMinor = toMinorUnits(charge.amount, Asset.NGN);
  // Business deposit fee (admin-set, default 0): credit net, record gross+fee.
  const feeMinor = feeFromBps(amountMinor, await getDepositFeeBps());
  const credit = await creditBalance({
    userId,
    asset: Asset.NGN,
    amountMinor,
    feeMinor,
    type: TransactionType.DEPOSIT,
    idempotencyKey: `deposit:${source}:${charge.eventId}`,
    network: Network.FIAT,
    externalRef: charge.txRef,
    metadata: { source: "virtual_account", eventId: charge.eventId },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "ngn.deposit.credited",
      resourceType: "Transaction",
      resourceId: credit.transactionId,
      details: {
        amountMinor: amountMinor.toString(),
        feeMinor: feeMinor.toString(),
        txRef: charge.txRef,
        via: "static_virtual_account",
      },
    },
  });

  return credit.created
    ? {
        status: "credited" as const,
        transactionId: credit.transactionId,
        userId,
        amountMinor: (amountMinor - feeMinor).toString(),
      }
    : { status: "already_credited" as const, transactionId: credit.transactionId };
}
