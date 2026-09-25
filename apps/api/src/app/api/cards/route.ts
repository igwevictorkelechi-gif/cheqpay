import { Asset, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { ensureCardsTable } from "@/lib/ensureCards";
import { cardsAvailable } from "@/lib/cards";
import { createCard } from "@/lib/maplerad/issuing";
import { describeProviderError } from "@/lib/mapleradCustomer";
import { chargeCardIssueFee, linkCardIssueFee, refundCardIssueFee } from "@/lib/cardFunding";
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

    // A provider failure here is not our bug and must not read as one. Left
    // unhandled it surfaces as a bare 500 "Internal server error", which tells
    // the user nothing and hides that the call never reached Maplerad — the
    // live failure was the egress proxy answering 502 "upstream unreachable"
    // for POST /issuing while proxying every other Maplerad call fine.
    // The card's price comes out of the USD balance first, so no card is
    // requested that hasn't been paid for. Refunded below if the request fails,
    // and by the issuing webhook if Maplerad later reports the card failed.
    const charge = await chargeCardIssueFee(auth.id);

    let ack: Awaited<ReturnType<typeof createCard>>;
    try {
      ack = await createCard({ customerId: user.mapleradCustomerId, currency: "USD" });
    } catch (err) {
      if (charge) await refundCardIssueFee({ transactionId: charge.transactionId });
      console.error("[cards] issuing failed", {
        userId: auth.id,
        customerId: user.mapleradCustomerId,
        error: describeProviderError(err),
      });
      throw new ApiError(
        502,
        "Our card provider could not be reached just now, so no card was created and you were not charged. Please try again shortly.",
        "card_issuing_unavailable",
      );
    }

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
    if (charge) await linkCardIssueFee(charge.transactionId, ack.reference);
    return jsonOk(
      { card, fee: charge ? fromMinorUnits(charge.feeCents, Asset.USD) : "0.00" },
      202,
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
