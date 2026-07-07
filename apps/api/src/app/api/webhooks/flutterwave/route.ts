import {
  Asset,
  Network,
  Prisma,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { getPaymentProvider } from "@/payments";
import type { NgnChargeEvent } from "@/payments/types";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { creditBalance } from "@/lib/ledger";
import { toMinorUnits, fromMinorUnits } from "@/lib/money";
import { sendPush } from "@/lib/push";
import { feeFromBps, getDepositFeeBps } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Flutterwave webhook. Handles both deposit charges and payout (transfer)
 * results. Order: verify signature on raw body -> parse -> idempotency gate
 * -> apply atomically.
 */
export async function POST(req: Request) {
  try {
    const psp = getPaymentProvider();
    const rawBody = await req.text();
    const signature = req.headers.get("verif-hash") ?? req.headers.get("x-signature");

    if (!psp.verifyWebhookSignature(rawBody, signature)) {
      return jsonOk({ error: "Invalid signature", code: "bad_signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonOk({ error: "Invalid JSON", code: "bad_json" }, 400);
    }

    const charge = psp.parseChargeEvent(payload);
    const transfer = charge ? null : psp.parseTransferEvent(payload);
    const event = charge ?? transfer;
    if (!event) {
      return jsonOk({ error: "Unrecognized event", code: "unrecognized" }, 400);
    }

    // Idempotency gate (first writer wins).
    try {
      await prisma.webhookEvent.create({
        data: {
          source: psp.name,
          eventId: event.eventId,
          payload: payload as Prisma.InputJsonValue,
          signatureValid: true,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return jsonOk({ status: "duplicate", eventId: event.eventId });
      }
      throw err;
    }

    let result = charge
      ? await finalizeDeposit(charge.txRef, charge.amount, charge.status)
      : await finalizeWithdrawal(transfer!.reference, transfer!.status);

    // Transfers into a STATIC virtual account have no pre-created PENDING
    // transaction (the VA's tx_ref is minted once at account creation), so an
    // "unmatched" successful charge is credited to the VA's owner directly.
    if (charge && result.status === "unmatched" && charge.status === "successful") {
      result = await creditStaticVaDeposit(charge);
    }

    await markProcessed(psp.name, event.eventId);

    // Fire notifications after the ledger has committed (best-effort).
    if (result.status === "credited" && result.userId) {
      await sendPush(result.userId, {
        category: "deposits",
        title: "Deposit received",
        body: `₦${fromMinorUnits(BigInt(result.amountMinor!), Asset.NGN)} has landed in your CheqPay wallet.`,
        data: { transactionId: result.transactionId },
      });
    } else if (result.status === "reversed" && result.userId) {
      await sendPush(result.userId, {
        category: "withdrawals",
        title: "Withdrawal reversed",
        body: `Your payout of ₦${fromMinorUnits(BigInt(result.amountMinor!), Asset.NGN)} failed and was refunded.`,
        data: { transactionId: result.transactionId },
      });
    } else if (result.status === "completed" && result.userId) {
      await sendPush(result.userId, {
        category: "withdrawals",
        title: "Withdrawal sent",
        body: "Your payout was completed successfully.",
        data: { transactionId: result.transactionId },
      });
    }

    return jsonOk({ ...result, eventId: event.eventId });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Credit a PENDING deposit on a successful charge (atomic + idempotent). */
async function finalizeDeposit(
  txRef: string,
  amount: string,
  status: "successful" | "failed" | "pending"
) {
  return prisma.$transaction(async (tx) => {
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
    };
  });
}

/** Complete or reverse a PROCESSING withdrawal based on the payout result. */
async function finalizeWithdrawal(
  reference: string,
  status: "successful" | "failed" | "pending"
) {
  return prisma.$transaction(async (tx) => {
    const wd = await tx.transaction.findFirst({
      where: { id: reference, type: TransactionType.WITHDRAWAL, asset: Asset.NGN },
    });
    if (!wd) return { status: "unmatched" as const };
    if (
      wd.status === TransactionStatus.COMPLETED ||
      wd.status === TransactionStatus.REVERSED
    ) {
      return { status: "already_final" as const, transactionId: wd.id };
    }

    if (status === "successful") {
      await tx.transaction.update({
        where: { id: wd.id },
        data: { status: TransactionStatus.COMPLETED },
      });
      return {
        status: "completed" as const,
        transactionId: wd.id,
        userId: wd.userId,
        amountMinor: wd.amount.toString(),
      };
    }

    if (status === "failed") {
      // Refund the debited funds (amount + any fee) and reverse.
      await tx.balance.update({
        where: { userId_asset: { userId: wd.userId, asset: Asset.NGN } },
        data: { available: { increment: wd.amount + wd.fee } },
      });
      await tx.transaction.update({
        where: { id: wd.id },
        data: { status: TransactionStatus.REVERSED },
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
}

function markProcessed(source: string, eventId: string) {
  return prisma.webhookEvent.update({
    where: { source_eventId: { source, eventId } },
    data: { processedAt: new Date() },
  });
}

/**
 * Credit a successful charge that arrived via the user's STATIC virtual
 * account. Resolution order:
 *   1. the VA tx_ref we minted at creation embeds the owner ("va_<userId>_<ts>")
 *   2. otherwise the charge's customer email, but only when that user actually
 *      owns an NGN virtual account (conservative — we never guess with money)
 * The credit is idempotent on the provider event id, so replays can't double-credit.
 */
async function creditStaticVaDeposit(charge: NgnChargeEvent) {
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
    idempotencyKey: `deposit:flutterwave:${charge.eventId}`,
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
