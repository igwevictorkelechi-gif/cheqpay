// apps/api/src/lib/ngnPayout.ts
//
// One NGN bank payout, from the user's NGN balance to their OWN bank account.
// Shared by the withdrawal route (a person tapping "Withdraw") and auto
// cash-out (a crypto deposit sold and paid out without a tap), so both obey
// exactly the same rules:
//
//   1. the account must be in the user's KYC legal name (resolved live);
//   2. tier single-transaction and daily limits, under a per-user lock;
//   3. atomic debit that refuses to overdraw, plus a PROCESSING transaction;
//   4. the PSP transfer; a definite rejection refunds, an unclear answer is
//      held for reconciliation and a human is told;
//   5. the final state arrives by the transfer webhook (COMPLETED / REVERSED).
//
// Authorisation (session, PIN, idempotency replay) stays with the caller.

import { Asset, Prisma, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { getPaymentProvider } from "@/payments";
import { ApiError } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";
import { assertWithdrawalAllowed, lockUserMoney, sumTodayWithdrawalsNgnKobo } from "@/lib/limits";
import { accountNameMatchesUser } from "@/lib/nameMatch";
import { isDefiniteRejection } from "@/lib/providerErrors";
import { notifyAdminAlert } from "@/lib/adminAlert";
import { MAX_TIER } from "@/lib/kyc";
import { getEnv } from "@/lib/env";
import { getWithdrawalFeeNgn } from "@/lib/settings";
import { withdrawalBreakdown } from "@/lib/fees";

export interface NgnPayoutParams {
  user: { id: string; legalName: string | null; kycTier: number };
  bankCode: string;
  accountNumber: string;
  narration?: string;
  /** What the user asked for, in kobo. See `feeInclusive`. */
  requestedMinor: bigint;
  /** true: the fee comes out of `requestedMinor`; false: it is debited on top. */
  feeInclusive: boolean;
  idempotencyKey: string;
  ip?: string | null;
  /** Extra fields kept on the transaction's metadata (e.g. the auto cash-out it belongs to). */
  extraMetadata?: Record<string, string | number | boolean | null>;
}

export interface NgnPayoutResult {
  transactionId: string;
  status: "processing";
  /** Debited from the balance (payout + fee), kobo. */
  totalMinor: bigint;
  feeMinor: bigint;
  /** What the bank receives, kobo. */
  amountMinor: bigint;
  /** The provider gave no clear answer; held for the webhook or reconcile job. */
  unclear: boolean;
  accountName: string;
}

export async function initiateNgnPayout(p: NgnPayoutParams): Promise<NgnPayoutResult> {
  const userId = p.user.id;

  // Money only leaves to an account in the user's own verified name. A
  // stolen session can then at worst move money to the owner's own bank —
  // it can't cash out to a stranger. Checked against the KYC legal name,
  // never the profile name, which the user can edit.
  const legalName = (p.user.legalName ?? "").trim();
  if (!legalName) {
    throw new ApiError(
      403,
      "Complete identity verification before withdrawing to a bank account.",
      "kyc_name_required"
    );
  }
  const { accountName } = await getPaymentProvider().resolveBankAccount({
    accountNumber: p.accountNumber,
    bankCode: p.bankCode,
  });
  if (!accountName) {
    throw new ApiError(422, "Could not verify that account number", "resolve_failed");
  }
  if (!accountNameMatchesUser(accountName, legalName)) {
    throw new ApiError(
      422,
      "This account isn’t in your name. You can only withdraw to your own bank account.",
      "name_mismatch"
    );
  }

  // Business withdrawal fee (admin-set flat NGN, default 0).
  //  - feeInclusive: the fee comes out of the typed amount. The balance drops by
  //    exactly what the user typed and the bank receives the rest, so "Max"
  //    (the whole balance) always works. See lib/fees.ts.
  //  - otherwise (older clients): the bank receives the typed amount and the fee
  //    is debited on top.
  // Either way the row records amount = what the bank receives and fee = fee,
  // so the refund and reversal paths (amount + fee) stay correct.
  const feeMinor = BigInt(Math.round((await getWithdrawalFeeNgn()) * 100));
  const { payoutMinor: amountMinor, grossMinor: totalMinor } = p.feeInclusive
    ? withdrawalBreakdown(p.requestedMinor, feeMinor)
    : { payoutMinor: p.requestedMinor, grossMinor: p.requestedMinor + feeMinor };

  const effectiveTier = getEnv().RELAX_WITHDRAWAL_GUARDS ? MAX_TIER : p.user.kycTier;
  const baseMetadata = {
    bankCode: p.bankCode,
    accountNumber: p.accountNumber,
    accountName,
    ip: p.ip ?? null,
    ...(p.extraMetadata ?? {}),
  };

  // Limit check + atomic debit + record, as one step per user: the lock makes
  // parallel requests take turns, so they can't each pass the daily limit
  // on the same starting total. Throws (rolls back) on insufficient funds.
  const tx = await prisma.$transaction(async (db) => {
    await lockUserMoney(db, userId);
    const usedToday = await sumTodayWithdrawalsNgnKobo(userId, db);
    assertWithdrawalAllowed(effectiveTier, amountMinor, usedToday);

    const debit = await db.balance.updateMany({
      where: { userId, asset: Asset.NGN, available: { gte: totalMinor } },
      data: { available: { decrement: totalMinor } },
    });
    if (debit.count !== 1) {
      throw new ApiError(
        422,
        feeMinor > 0n && !p.feeInclusive
          ? "Insufficient NGN balance (amount + withdrawal fee)"
          : "Insufficient NGN balance",
        "insufficient_funds"
      );
    }
    return db.transaction.create({
      data: {
        userId,
        type: TransactionType.WITHDRAWAL,
        asset: Asset.NGN,
        amount: amountMinor,
        fee: feeMinor,
        status: TransactionStatus.PROCESSING,
        idempotencyKey: p.idempotencyKey,
        metadata: baseMetadata as Prisma.InputJsonValue,
      },
    });
  });

  // Initiate the payout. The transfer reference is our transaction id so the
  // webhook can finalize it. Only the provider call sits inside this try:
  // bookkeeping that fails AFTER the transfer went out must never trigger a
  // refund, or the user would be paid twice.
  let transfer: { providerRef: string };
  try {
    transfer = await getPaymentProvider().initiateTransfer({
      // What the bank receives — the typed amount minus the fee when fee-inclusive.
      amount: fromMinorUnits(amountMinor, Asset.NGN),
      bankCode: p.bankCode,
      accountNumber: p.accountNumber,
      reference: tx.id,
      narration: p.narration,
    });
  } catch (err) {
    if (isDefiniteRejection(err)) {
      // The provider refused outright — nothing was sent. Refund (amount +
      // fee) and fail, claiming the row so a late webhook can't refund again.
      await prisma.$transaction(async (db) => {
        const claimed = await db.transaction.updateMany({
          where: { id: tx.id, status: TransactionStatus.PROCESSING },
          data: { status: TransactionStatus.FAILED },
        });
        if (claimed.count !== 1) return;
        await db.balance.update({
          where: { userId_asset: { userId, asset: Asset.NGN } },
          data: { available: { increment: totalMinor } },
        });
      });
      throw new ApiError(502, "Payout could not be initiated; funds refunded", "payout_failed");
    }
    // We don't know whether it went out. Leave it in flight for the webhook
    // or the reconcile job to settle, and tell a human.
    await prisma.transaction
      .update({
        where: { id: tx.id },
        data: { metadata: { ...baseMetadata, needsReconcile: true } as Prisma.InputJsonValue },
      })
      .catch(() => undefined);
    await notifyAdminAlert(
      `⚠️ NGN payout ${tx.id} got no clear answer from the provider (${String(err).slice(0, 120)}). Held as processing — check it before refunding.`,
      { transactionId: tx.id }
    ).catch(() => undefined);
    return { transactionId: tx.id, status: "processing", totalMinor, feeMinor, amountMinor, unclear: true, accountName };
  }

  // The transfer is out. Bookkeeping from here is best-effort.
  await prisma.transaction
    .update({ where: { id: tx.id }, data: { externalRef: transfer.providerRef } })
    .catch((err) => console.error("[ngn payout] could not record providerRef", tx.id, err));
  await prisma.auditLog
    .create({
      data: {
        userId,
        ipAddress: p.ip ?? null,
        action: "ngn.withdrawal.initiated",
        resourceType: "Transaction",
        resourceId: tx.id,
        details: {
          amountMinor: amountMinor.toString(),
          providerRef: transfer.providerRef,
          ...(p.extraMetadata ?? {}),
        },
      },
    })
    .catch(() => undefined);
  return { transactionId: tx.id, status: "processing", totalMinor, feeMinor, amountMinor, unclear: false, accountName };
}
