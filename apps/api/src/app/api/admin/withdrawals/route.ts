import {
  Asset,
  Network,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { getCustodyProvider } from "@/custody";
import { getPaymentProvider } from "@/payments";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";
import { reviewActionSchema } from "@/lib/validation";
import { isManualAsset } from "@/lib/manualCrypto";
import { sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Admin: list withdrawals held for AML review. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const held = await prisma.transaction.findMany({
      where: { type: TransactionType.WITHDRAWAL, status: TransactionStatus.PENDING },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return jsonOk({
      withdrawals: held.map((w) => ({
        id: w.id,
        userId: w.userId,
        asset: w.asset,
        network: w.network,
        amount: w.amount.toString(),
        amountFormatted: fromMinorUnits(w.amount, w.asset),
        metadata: w.metadata,
        createdAt: w.createdAt,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: approve (release/broadcast) or reject (refund) a held withdrawal. */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const { transactionId, action, txHash } = reviewActionSchema.parse(await req.json());

    const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx || tx.type !== TransactionType.WITHDRAWAL) {
      throw new ApiError(404, "Withdrawal not found", "not_found");
    }
    if (tx.status !== TransactionStatus.PENDING) {
      throw new ApiError(409, `Withdrawal is not pending review (${tx.status})`, "not_pending");
    }

    const meta = (tx.metadata ?? {}) as {
      toAddress?: string;
      bankCode?: string;
      accountNumber?: string;
    };

    if (action === "reject") {
      await prisma.$transaction([
        prisma.balance.update({
          where: { userId_asset: { userId: tx.userId, asset: tx.asset } },
          data: { available: { increment: tx.amount } },
        }),
        prisma.transaction.update({
          where: { id: tx.id },
          data: { status: TransactionStatus.REVERSED },
        }),
        prisma.auditLog.create({
          data: {
            userId: tx.userId,
            action: "withdrawal.review.rejected",
            resourceType: "Transaction",
            resourceId: tx.id,
            details: { asset: tx.asset, amount: tx.amount.toString() },
          },
        }),
      ]);
      return jsonOk({ transactionId: tx.id, status: "reversed" });
    }

    // approve — release the reserved funds to the destination.
    const amount = fromMinorUnits(tx.amount, tx.asset);
    try {
      if (tx.asset === Asset.NGN) {
        const psp = getPaymentProvider();
        const transfer = await psp.initiateTransfer({
          amount,
          bankCode: meta.bankCode ?? "",
          accountNumber: meta.accountNumber ?? "",
          reference: tx.id,
        });
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: TransactionStatus.PROCESSING, externalRef: transfer.providerRef },
        });
      } else if (await isManualAsset(tx.asset)) {
        // Manual custody: the admin has already sent the funds from the
        // business wallet — approving records completion (+ on-chain hash).
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: TransactionStatus.COMPLETED,
            ...(txHash ? { txHash, externalRef: txHash } : {}),
          },
        });
        await sendPush(tx.userId, {
          category: "withdrawals",
          title: "Crypto withdrawal sent",
          body: `Your ${amount} ${tx.asset} withdrawal has been sent.`,
          data: { transactionId: tx.id, ...(txHash ? { txHash } : {}) },
        });
      } else {
        const custody = getCustodyProvider();
        const result = await custody.createWithdrawal({
          userId: tx.userId,
          asset: tx.asset,
          network: (tx.network ?? Network.BITCOIN) as Network,
          toAddress: meta.toAddress ?? "",
          amount,
        });
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: TransactionStatus.PROCESSING,
            txHash: result.txHash,
            externalRef: result.txHash,
          },
        });
      }
      await prisma.auditLog.create({
        data: {
          userId: tx.userId,
          action: "withdrawal.review.approved",
          resourceType: "Transaction",
          resourceId: tx.id,
          details: { asset: tx.asset, amount: tx.amount.toString() },
        },
      });
      return jsonOk({ transactionId: tx.id, status: "processing" });
    } catch {
      throw new ApiError(502, "Approved but the provider could not send; left pending", "provider_failed");
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
