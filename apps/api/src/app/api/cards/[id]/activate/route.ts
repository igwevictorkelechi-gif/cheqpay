import { Asset } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { cardFundSchema } from "@/lib/validation";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { enforceRateLimit } from "@/lib/ratelimit";
import { activateCard } from "@/lib/cardIssue";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Step 2 of getting a card: fund the paid slot with a first top-up, which is
 * when the card is requested from Maplerad (with the top-up loaded on it).
 * Idempotent on the Idempotency-Key header; needs the transaction PIN.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("virtual_cards");
    await enforceRateLimit(`card-move:${auth.id}`, 10, 60_000);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }
    const body = cardFundSchema.parse(await req.json());
    await requireTransactionPin(auth.id, readPin(req));

    const { card, feeCents } = await activateCard({
      userId: auth.id,
      cardId: params.id,
      amount: body.amount,
      idempotencyKey,
    });
    return jsonOk({ card, fee: fromMinorUnits(feeCents, Asset.USD) }, 202);
  } catch (err) {
    return toErrorResponse(err);
  }
}
