import { Asset, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { ensureCardsTable } from "@/lib/ensureCards";
import { cardsAvailable } from "@/lib/cards";
import { cardIssueKey } from "@/lib/cardFunding";
import { payForCard } from "@/lib/cardIssue";
import { enforceRateLimit } from "@/lib/ratelimit";
import { fromMinorUnits } from "@/lib/money";

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
 * Step 1 of getting a card: pay the card fee and reserve a card slot.
 *
 * Nothing is requested from Maplerad yet — the card is created when the person
 * funds it (POST /api/cards/{id}/activate). Someone who already has a paid,
 * unfunded card gets that one back rather than paying again. See
 * lib/cardIssue.ts for the whole flow.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("virtual_cards");
    await enforceRateLimit(`card-create:${auth.id}`, 5, 60 * 60_000);

    // A card costs money, so a double tap or a retried request must not buy
    // two. The key names this request; a repeat returns the same slot.
    const requestKey = req.headers.get("idempotency-key");
    if (!requestKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }
    const prior = await prisma.transaction.findUnique({
      where: { idempotencyKey: cardIssueKey(auth.id, requestKey) },
      select: { metadata: true },
    });
    const priorCardId =
      prior?.metadata && typeof prior.metadata === "object"
        ? (prior.metadata as { cardId?: string }).cardId
        : undefined;
    if (priorCardId) {
      const card = await prisma.card.findFirst({
        where: { id: priorCardId, userId: auth.id },
        select: CARD_SELECT,
      });
      if (card) return jsonOk({ card, fee: "0.00", alreadyPaid: true }, 200);
    }

    const { card, feeCents, alreadyPaid } = await payForCard(auth.id, requestKey);
    return jsonOk({ card, fee: fromMinorUnits(feeCents, Asset.USD), alreadyPaid }, alreadyPaid ? 200 : 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
