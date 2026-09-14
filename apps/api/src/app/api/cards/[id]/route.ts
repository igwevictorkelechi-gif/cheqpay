import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { ensureCardsTable } from "@/lib/ensureCards";
import { getCard } from "@/lib/maplerad/issuing";

export const dynamic = "force-dynamic";

/**
 * Fetch one of the user's cards.
 *
 * The stored row is authoritative for identity (brand, masked pan) and is kept
 * current by the issuing webhook. The live balance and current status are read
 * from the provider on demand — never stored — so the pocket can show a real
 * balance. A provider hiccup degrades to the stored row rather than failing the
 * page; `balanceMinor` is simply null when we could not read it. This route
 * never returns the full PAN or CVV — that is the reveal route alone.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireUser(req);
    await ensureCardsTable();
    const card = await prisma.card.findFirst({
      where: { id: params.id, userId: auth.id },
      select: {
        id: true,
        currency: true,
        brand: true,
        maskedPan: true,
        status: true,
        providerCardId: true,
        createdAt: true,
      },
    });
    if (!card) throw new ApiError(404, "Card not found", "not_found");

    let balanceMinor: string | null = null;
    let liveStatus: string | null = null;
    if (card.providerCardId) {
      try {
        const detail = await getCard(card.providerCardId);
        if (Number.isFinite(detail.balance)) balanceMinor = String(detail.balance);
        if (typeof detail.status === "string") liveStatus = detail.status;
      } catch {
        // Degrade to the stored row — the card still renders, just without a
        // live balance this load.
      }
    }

    const { providerCardId: _omit, ...safe } = card;
    return jsonOk({ card: { ...safe, balanceMinor, liveStatus } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
