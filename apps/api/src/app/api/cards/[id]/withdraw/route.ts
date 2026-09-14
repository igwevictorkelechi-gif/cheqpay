import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { ensureCardsTable } from "@/lib/ensureCards";
import { withdrawUserCard } from "@/lib/cardFunding";
import { cardFundSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Move USD off the card back to the user's balance. Idempotent on the header key. */
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

    const res = await withdrawUserCard({
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
