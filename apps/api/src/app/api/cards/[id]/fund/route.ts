import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { ensureCardsTable } from "@/lib/ensureCards";
import { fundUserCard } from "@/lib/cardFunding";
import { cardFundSchema } from "@/lib/validation";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";

export const dynamic = "force-dynamic";

/** Move USD from the user's balance onto their card. Idempotent on the header key. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("virtual_cards");
    await ensureCardsTable();

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }
    const body = cardFundSchema.parse(await req.json());

    // Authorise the movement before anything is debited. Replay handling
    // lives inside the cardFunding helper, so the PIN is checked first here.
    await requireTransactionPin(auth.id, readPin(req));

    const res = await fundUserCard({
      userId: auth.id,
      cardId: params.id,
      amount: body.amount,
      idempotencyKey,
    });
    return jsonOk(res);
  } catch (err) {
    return toErrorResponse(err);
  }
}
