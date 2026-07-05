import {
  Asset,
  Prisma,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { getPaymentProvider } from "@/payments";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { toMinorUnits, fromMinorUnits } from "@/lib/money";
import { sendPush } from "@/lib/push";

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

    const result = charge
      ? await finalizeDeposit(charge.txRef, charge.amount, charge.status)
      : await finalizeWithdrawal(transfer!.reference, transfer!.status);

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
    await tx.balance.upsert({
      where: { userId_asset: { userId: dep.userId, asset: Asset.NGN } },
      update: { available: { increment: amountMinor } },
      create: { userId: dep.userId, asset: Asset.NGN, available: amountMinor },
    });
    await tx.transaction.update({
      where: { id: dep.id },
      data: { status: TransactionStatus.COMPLETED, amount: amountMinor },
    });
    await tx.auditLog.create({
      data: {
        userId: dep.userId,
        action: "ngn.deposit.credited",
        resourceType: "Transaction",
        resourceId: dep.id,
        details: { amountMinor: amountMinor.toString(), txRef },
      },
    });
    return {
      status: "credited" as const,
      transactionId: dep.id,
      userId: dep.userId,
      amountMinor: amountMinor.toString(),
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
      // Refund the debited funds and reverse.
      await tx.balance.update({
        where: { userId_asset: { userId: wd.userId, asset: Asset.NGN } },
        data: { available: { increment: wd.amount } },
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
