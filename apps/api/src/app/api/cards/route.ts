import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { ensureCardsTable } from "@/lib/ensureCards";
import { cardsAvailable } from "@/lib/cards";
import { createCard } from "@/lib/maplerad/issuing";

export const dynamic = "force-dynamic";

const CARD_SELECT = {
  id: true,
  currency: true,
  brand: true,
  maskedPan: true,
  status: true,
  createdAt: true,
} as const;

/** List the user's virtual cards. Always reports whether issuing is available. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await ensureCardsTable();
    const cards = await prisma.card.findMany({
      where: { userId: auth.id },
      orderBy: { createdAt: "desc" },
      select: CARD_SELECT,
    });
    return jsonOk({ cards, available: cardsAvailable() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Request a new USD virtual card (Maplerad). Issuing is ASYNC: Maplerad returns
 * a reference immediately and confirms the card by webhook, so we store a
 * `pending` card now and reconcile it in the issuing webhook.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("virtual_cards");
    await ensureCardsTable();

    // Card issuing hangs off an enrolled Maplerad customer, which is created at
    // KYC approval (needs the BVN). No customer id ⇒ the user hasn't completed
    // the KYC that enrolls them.
    const user = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { mapleradCustomerId: true },
    });
    if (!user?.mapleradCustomerId) {
      throw new ApiError(
        409,
        "Complete your identity verification (KYC) before creating a card.",
        "kyc_required"
      );
    }

    const ack = await createCard({ customerId: user.mapleradCustomerId, currency: "USD" });

    const card = await prisma.card.create({
      data: {
        userId: auth.id,
        provider: "maplerad",
        reference: ack.reference,
        currency: "USD",
        status: "pending",
      },
      select: CARD_SELECT,
    });
    return jsonOk({ card }, 202);
  } catch (err) {
    return toErrorResponse(err);
  }
}
