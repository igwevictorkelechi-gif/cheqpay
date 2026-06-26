import { Prisma, TransactionType, prisma } from "@cheqpay/db";
import { getCustodyProvider } from "@/custody";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { creditBalance } from "@/lib/ledger";
import { toMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Custody deposit webhook. Order matters:
 *   1. verify signature on the RAW body (reject before any state change)
 *   2. parse + normalize the event
 *   3. idempotency gate via WebhookEvent(source, eventId) unique
 *   4. match address -> wallet -> user, credit the ledger atomically
 */
export async function POST(req: Request) {
  try {
    const custody = getCustodyProvider();
    const rawBody = await req.text();
    const signature =
      req.headers.get("x-payload-hash") ?? req.headers.get("x-signature");

    if (!custody.verifyWebhookSignature(rawBody, signature)) {
      // Do not record unverified payloads; just reject.
      return jsonOk({ error: "Invalid signature", code: "bad_signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonOk({ error: "Invalid JSON", code: "bad_json" }, 400);
    }

    const deposit = custody.parseDepositEvent(payload);
    if (!deposit) {
      return jsonOk({ error: "Unrecognized event", code: "unrecognized" }, 400);
    }

    // Idempotency gate: first writer wins; replays short-circuit.
    try {
      await prisma.webhookEvent.create({
        data: {
          source: custody.name,
          eventId: deposit.eventId,
          payload: payload as Prisma.InputJsonValue,
          signatureValid: true,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return jsonOk({ status: "duplicate", eventId: deposit.eventId });
      }
      throw err;
    }

    // Match the incoming (network, address) to a wallet.
    const wallet = await prisma.wallet.findUnique({
      where: {
        network_address: { network: deposit.network, address: deposit.address },
      },
    });

    if (!wallet) {
      await markProcessed(custody.name, deposit.eventId);
      return jsonOk({ status: "unmatched", eventId: deposit.eventId });
    }

    const amountMinor = toMinorUnits(deposit.amount, deposit.asset);

    const result = await creditBalance({
      userId: wallet.userId,
      asset: deposit.asset,
      amountMinor,
      type: TransactionType.DEPOSIT,
      idempotencyKey: `deposit:${custody.name}:${deposit.eventId}`,
      network: deposit.network,
      txHash: deposit.txHash,
      externalRef: deposit.eventId,
      metadata: { address: deposit.address },
    });

    await Promise.all([
      markProcessed(custody.name, deposit.eventId),
      prisma.auditLog.create({
        data: {
          userId: wallet.userId,
          action: "deposit.credited",
          resourceType: "Transaction",
          resourceId: result.transactionId,
          details: {
            asset: deposit.asset,
            network: deposit.network,
            amountMinor: amountMinor.toString(),
            txHash: deposit.txHash,
          },
        },
      }),
    ]);

    return jsonOk({
      status: result.created ? "credited" : "already_credited",
      transactionId: result.transactionId,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function markProcessed(source: string, eventId: string) {
  return prisma.webhookEvent.update({
    where: { source_eventId: { source, eventId } },
    data: { processedAt: new Date() },
  });
}
