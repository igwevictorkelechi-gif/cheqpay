import { prisma } from "@cheqpay/db";
import { requireUser, requireMfa } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { ensureCardsTable } from "@/lib/ensureCards";
import { getCard } from "@/lib/maplerad/issuing";

export const dynamic = "force-dynamic";

/**
 * The card's full number, CVV and expiry — the secrets needed to type it into a
 * checkout. Highest-sensitivity action on a card, so it is gated on step-up 2FA
 * (the same bar crypto withdrawals use) as well as ownership. The values come
 * straight from the provider and are never stored; the client's log redaction
 * keeps the PAN and CVV out of the logs.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireUser(req);
    requireMfa(auth);
    await ensureCardsTable();

    const card = await prisma.card.findFirst({
      where: { id: params.id, userId: auth.id },
      select: { providerCardId: true, status: true },
    });
    if (!card) throw new ApiError(404, "Card not found", "not_found");
    if (!card.providerCardId) {
      throw new ApiError(409, "This card is still being issued.", "card_pending");
    }

    const detail = await getCard(card.providerCardId);
    return jsonOk({
      card: {
        name: detail.name ?? null,
        number: detail.card_number ?? null,
        maskedPan: detail.masked_pan ?? null,
        expiry: detail.expiry ?? null,
        cvv: detail.cvv ?? null,
        brand: detail.issuer ?? null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
