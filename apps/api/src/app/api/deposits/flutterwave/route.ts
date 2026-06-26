import { randomUUID } from "node:crypto";
import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { isWithinSingleTxLimit } from "@/lib/kyc";
import { toMinorUnits } from "@/lib/money";
import { depositInitSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Begin an NGN deposit. Creates a PENDING deposit transaction with a unique
 * txRef the client passes to the Flutterwave checkout. The balance is only
 * credited later, by the verified webhook (POST /api/webhooks/flutterwave).
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }

    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    const { amount } = depositInitSchema.parse(await req.json());
    const amountMinor = toMinorUnits(amount, Asset.NGN);
    if (!isWithinSingleTxLimit(user.kycTier, amountMinor)) {
      throw new ApiError(403, "Amount exceeds your per-transaction limit", "single_tx_limit");
    }

    // Idempotent: return the existing intent if this key was already used.
    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return jsonOk({ txRef: existing.externalRef, transactionId: existing.id, amount });
    }

    const txRef = `cheqpay-dep-${randomUUID()}`;
    const record = await prisma.transaction.create({
      data: {
        userId: auth.id,
        type: TransactionType.DEPOSIT,
        asset: Asset.NGN,
        amount: amountMinor,
        status: TransactionStatus.PENDING,
        idempotencyKey,
        externalRef: txRef,
      },
    });

    // The client completes payment with Flutterwave using this txRef + amount.
    return jsonOk({ txRef, transactionId: record.id, amount, currency: "NGN" }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
