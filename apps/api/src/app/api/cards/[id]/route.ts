import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { ensureCardsTable } from "@/lib/ensureCards";
import { getMapleradCard } from "@/lib/mapleradCards";

export const dynamic = "force-dynamic";

/** Fetch one of the user's cards, refreshed with safe metadata from Maplerad. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireUser(req);
    await ensureCardsTable();
    const card = await prisma.card.findFirst({
      where: { id: params.id, userId: auth.id },
    });
    if (!card) throw new ApiError(404, "Card not found", "not_found");

    // Best-effort refresh of status/metadata from the provider.
    let status = card.status;
    let maskedPan = card.maskedPan;
    try {
      const live = await getMapleradCard(card.providerCardId);
      status = live.status ?? status;
      maskedPan = live.maskedPan ?? maskedPan;
      if (status !== card.status || maskedPan !== card.maskedPan) {
        await prisma.card.update({ where: { id: card.id }, data: { status, maskedPan } });
      }
    } catch {
      // Provider unreachable — return the stored snapshot.
    }

    return jsonOk({
      card: {
        id: card.id,
        currency: card.currency,
        brand: card.brand,
        maskedPan,
        status,
        createdAt: card.createdAt,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
