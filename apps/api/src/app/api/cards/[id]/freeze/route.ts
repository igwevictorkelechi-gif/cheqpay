import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { ensureCardsTable } from "@/lib/ensureCards";
import { freezeCard, unfreezeCard } from "@/lib/maplerad/issuing";
import { cardFreezeSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Freeze or unfreeze a card. Body `{ freeze: boolean }`. The provider call runs
 * first; our stored status is updated only once it succeeds, so the list never
 * shows a state the provider does not actually hold.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("virtual_cards");
    await ensureCardsTable();
    const { freeze } = cardFreezeSchema.parse(await req.json());

    const card = await prisma.card.findFirst({
      where: { id: params.id, userId: auth.id },
      select: { providerCardId: true },
    });
    if (!card) throw new ApiError(404, "Card not found", "not_found");
    if (!card.providerCardId) {
      throw new ApiError(409, "This card is still being issued.", "card_pending");
    }

    if (freeze) await freezeCard(card.providerCardId);
    else await unfreezeCard(card.providerCardId);

    await prisma.card.update({
      where: { id: params.id },
      data: { status: freeze ? "frozen" : "active" },
    });
    return jsonOk({ status: freeze ? "frozen" : "active" });
  } catch (err) {
    return toErrorResponse(err);
  }
}
