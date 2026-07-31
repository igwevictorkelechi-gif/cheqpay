import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits, toMinorUnits } from "@/lib/money";
import { enforceRateLimit } from "@/lib/ratelimit";
import { assertFeatureEnabled } from "@/lib/features";
import { userTransferSchema } from "@/lib/validation";
import { notifyUser } from "@/lib/alerts";
import { ensureTransferEnums } from "@/lib/ensureTransfers";

export const dynamic = "force-dynamic";

/**
 * Send NGN or crypto to another CheqPay user by username.
 *
 * This is an internal ledger move — no provider, no chain — so it settles
 * instantly and is recorded as a MATCHED PAIR of rows: TRANSFER_OUT for the
 * sender, TRANSFER_IN for the recipient. Each side then sees its own direction
 * in history and on statements.
 *
 * Money safety: the debit, the credit and both rows happen in ONE transaction
 * with a balance guard, so the money cannot leave one wallet without arriving
 * in the other. Both rows derive their idempotency key from the caller's
 * Idempotency-Key, so a retried request can never send twice.
 *
 * Note: transfers deliberately earn no cashback. They generate no revenue and
 * two accounts could otherwise bounce funds back and forth to mint rewards.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("p2p_transfers");
    enforceRateLimit(`transfer:${auth.id}`, 20, 60_000);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }

    const body = userTransferSchema.parse(await req.json());
    const asset = body.asset as Asset;
    const amountMinor = toMinorUnits(body.amount, asset);
    if (amountMinor <= 0n) {
      throw new ApiError(422, "Amount must be greater than zero", "bad_amount");
    }

    const recipient = await prisma.user.findFirst({
      where: { username: { equals: body.username, mode: "insensitive" } },
      select: { id: true, username: true, status: true },
    });
    if (!recipient) {
      throw new ApiError(404, "No CheqPay user with that username", "user_not_found");
    }
    if (recipient.id === auth.id) {
      throw new ApiError(422, "You can't send money to yourself", "self_transfer");
    }
    if (recipient.status !== "ACTIVE") {
      throw new ApiError(422, "That account can't receive transfers", "recipient_inactive");
    }

    // Replay of an earlier request — return the original instead of re-sending.
    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey: `${idempotencyKey}:out` },
    });
    if (existing) {
      return jsonOk({
        transactionId: existing.id,
        status: existing.status,
        alreadyProcessed: true,
      });
    }

    await ensureTransferEnums();

    const sender = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { username: true },
    });
    const senderLabel = sender?.username ? `@${sender.username}` : "a CheqPay user";
    const recipientLabel = `@${recipient.username}`;
    const shared = {
      kind: "transfer" as const,
      fromUsername: sender?.username ?? null,
      toUsername: recipient.username,
      note: body.note ?? null,
    };

    const out = await prisma.$transaction(async (db) => {
      // Guarded debit: updateMany with a balance floor means an overdraw
      // changes zero rows instead of going negative.
      const debit = await db.balance.updateMany({
        where: { userId: auth.id, asset, available: { gte: amountMinor } },
        data: { available: { decrement: amountMinor } },
      });
      if (debit.count !== 1) {
        throw new ApiError(422, `Insufficient ${asset} balance`, "insufficient_funds");
      }

      await db.balance.upsert({
        where: { userId_asset: { userId: recipient.id, asset } },
        update: { available: { increment: amountMinor } },
        create: { userId: recipient.id, asset, available: amountMinor },
      });

      const sent = await db.transaction.create({
        data: {
          userId: auth.id,
          type: TransactionType.TRANSFER_OUT,
          asset,
          amount: amountMinor,
          status: TransactionStatus.COMPLETED,
          idempotencyKey: `${idempotencyKey}:out`,
          metadata: { ...shared, direction: "out", counterparty: recipient.username },
        },
      });
      await db.transaction.create({
        data: {
          userId: recipient.id,
          type: TransactionType.TRANSFER_IN,
          asset,
          amount: amountMinor,
          status: TransactionStatus.COMPLETED,
          idempotencyKey: `${idempotencyKey}:in`,
          metadata: {
            ...shared,
            direction: "in",
            counterparty: sender?.username ?? null,
            relatedTransactionId: sent.id,
          },
        },
      });
      await db.auditLog.create({
        data: {
          userId: auth.id,
          action: "transfer.sent",
          resourceType: "Transaction",
          resourceId: sent.id,
          details: {
            asset,
            amountMinor: amountMinor.toString(),
            toUserId: recipient.id,
            toUsername: recipient.username,
          },
        },
      });
      return sent;
    });

    // Alerts are best-effort and run after the money has settled.
    const pretty = `${asset === Asset.NGN ? "₦" : ""}${fromMinorUnits(amountMinor, asset)}${
      asset === Asset.NGN ? "" : ` ${asset}`
    }`;
    await Promise.all([
      notifyUser(auth.id, {
        category: "withdrawals",
        title: "Money sent",
        body: `You sent ${pretty} to ${recipientLabel}.`,
        data: { transactionId: out.id },
        details: [
          { label: "To", value: recipientLabel },
          { label: "Amount", value: pretty },
          ...(body.note ? [{ label: "Note", value: body.note }] : []),
        ],
      }),
      notifyUser(recipient.id, {
        category: "deposits",
        title: "Money received",
        body: `${senderLabel} sent you ${pretty}.`,
        data: { transactionId: out.id },
        details: [
          { label: "From", value: senderLabel },
          { label: "Amount", value: pretty },
          ...(body.note ? [{ label: "Note", value: body.note }] : []),
        ],
      }),
    ]);

    return jsonOk({
      transactionId: out.id,
      status: "completed",
      asset,
      amountFormatted: fromMinorUnits(amountMinor, asset),
      recipient: recipient.username,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
