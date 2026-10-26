import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Asset, UserStatus, prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ensureCardsTable } from "@/lib/ensureCards";
import { cardsAvailable } from "@/lib/cards";
import { UNFUNDED, activateCard, cancelUnfundedCard, payForCard } from "@/lib/cardIssue";
import { cardFundFee, cardIssueFee } from "@/lib/fees";
import { getPricing } from "@/lib/settings";
import { fromMinorUnits, toMinorUnits } from "@/lib/money";
import { notifyUser } from "@/lib/alerts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const CARD_SELECT = {
  id: true,
  currency: true,
  brand: true,
  maskedPan: true,
  status: true,
  createdAt: true,
} as const;

const createSchema = z.object({
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a dollar amount like 10 or 10.50"),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters").max(200),
  otp: z.string().min(6).max(8),
});

const usd = (cents: bigint) => `$${fromMinorUnits(cents, Asset.USD)}`;

async function usdAvailable(userId: string): Promise<bigint> {
  const row = await prisma.balance.findUnique({
    where: { userId_asset: { userId, asset: Asset.USD } },
    select: { available: true },
  });
  return row?.available ?? 0n;
}

/**
 * Admin: a user's virtual cards, and what creating one for them would cost.
 *
 * `hasPaidSlot` means they already paid the card fee for a card that was never
 * created, so a new card for them charges only the top-up and its fee.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true, mapleradCustomerId: true },
    });
    if (!user) throw new ApiError(404, "User not found", "no_user");

    await ensureCardsTable();
    const [cards, available, pricing] = await Promise.all([
      prisma.card.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, select: CARD_SELECT }),
      usdAvailable(id),
      getPricing(),
    ]);
    return jsonOk({
      cards,
      enrolled: Boolean(user.mapleradCustomerId),
      active: user.status === UserStatus.ACTIVE,
      issuingConfigured: cardsAvailable(),
      hasPaidSlot: cards.some((c) => c.status === UNFUNDED),
      usdAvailable: fromMinorUnits(available, Asset.USD),
      pricing: {
        cardIssueFeeUsd: pricing.cardIssueFeeUsd,
        cardFundMinUsd: pricing.cardFundMinUsd,
        cardFundFeeSmallUsd: pricing.cardFundFeeSmallUsd,
        cardFundFeeLargeBps: pricing.cardFundFeeLargeBps,
        cardFundThresholdUsd: pricing.cardFundThresholdUsd,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin: create a virtual card for a user, paid from THEIR USD balance — the
 * same card fee, top-up and top-up fee they would pay doing it themselves.
 *
 * It spends the user's money without their PIN, so it takes what a debit does:
 * a named admin, a fresh authenticator code, a written reason, an audit row and
 * an alert, and the user is told.
 *
 * All or nothing: if the card isn't created, a card fee this request charged is
 * refunded along with the top-up, so a failed attempt costs the user nothing.
 * A fee they had already paid for an earlier, uncreated card stays on that
 * card, as it would have.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const actor = await requireAdminActor(req);
    const { id } = await params;
    const body = createSchema.parse(await req.json());
    await requireAdminOtp(req, body.otp);
    await enforceRateLimit(`admin-card-create:${id}`, 5, 60 * 60_000);

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, status: true, mapleradCustomerId: true },
    });
    if (!user) throw new ApiError(404, "User not found", "no_user");
    if (user.status !== UserStatus.ACTIVE) {
      throw new ApiError(422, `This account is ${user.status.toLowerCase()} — it can't get a card.`, "account_not_active");
    }
    if (!user.mapleradCustomerId) {
      throw new ApiError(409, "This user isn't enrolled with Maplerad yet. Run Enrol / upgrade tier first.", "not_enrolled");
    }

    // Check the whole cost up front, so nothing is charged for a card the
    // balance can't finish paying for.
    await ensureCardsTable();
    const pricing = await getPricing();
    const topUp = toMinorUnits(body.amount, Asset.USD);
    const topUpFee = cardFundFee(topUp, pricing); // also enforces the minimum top-up
    const paidSlot = await prisma.card.findFirst({ where: { userId: id, status: UNFUNDED }, select: { id: true } });
    const issueFee = paidSlot ? 0n : cardIssueFee(pricing);
    const total = issueFee + topUp + topUpFee;
    const available = await usdAvailable(id);
    if (available < total) {
      throw new ApiError(
        422,
        `The user has ${usd(available)} in USD. This card needs ${usd(total)}: ` +
          `${issueFee > 0n ? `${usd(issueFee)} card fee, ` : ""}${usd(topUp)} top-up and ${usd(topUpFee)} top-up fee.`,
        "insufficient_funds",
      );
    }

    const slot = await payForCard(id, `admin:${randomUUID()}`);
    let created;
    try {
      created = await activateCard({
        userId: id,
        cardId: slot.card.id,
        amount: body.amount,
        idempotencyKey: `admin-card-fund:${randomUUID()}`,
      });
    } catch (err) {
      if (!slot.alreadyPaid) {
        try {
          await cancelUnfundedCard(id, slot.card.id);
        } catch (e) {
          console.error("[admin cards] refunding the card fee after a failed create failed", e);
        }
      }
      if (err instanceof ApiError && err.code === "card_issuing_unavailable") {
        throw new ApiError(
          502,
          slot.alreadyPaid
            ? "Maplerad didn't create the card. The top-up went back to the user's USD balance; the card fee they had already paid stays on their unfinished card. Run Provider check for the cause."
            : "Maplerad didn't create the card, so nothing was charged: the card fee and top-up went back to the user's USD balance. Run Provider check for the cause.",
          "card_issuing_unavailable",
        );
      }
      throw err;
    }

    const charged = slot.feeCents + topUp + created.feeCents;
    await recordAdminAction(req, actor, {
      action: "admin.card.created",
      summary: `Created a virtual card for ${user.email} with ${usd(topUp)} loaded (${usd(charged)} from their USD balance)`,
      userId: id,
      resourceType: "Card",
      resourceId: created.card.id,
      details: {
        reason: body.reason,
        topUpCents: topUp.toString(),
        topUpFeeCents: created.feeCents.toString(),
        cardFeeCents: slot.feeCents.toString(),
      },
    });

    await notifyUser(id, {
      category: "withdrawals",
      title: "Your virtual card is on its way",
      body:
        `CheqPay created a USD virtual card for you with ${usd(topUp)} on it. ` +
        `${usd(charged)} was taken from your USD balance` +
        (charged > topUp ? `, including ${usd(charged - topUp)} in fees.` : ".") +
        " It will be ready in the Cards tab in a moment.",
      data: { cardId: created.card.id },
    }).catch((e) => console.error("[admin cards] notifying the user failed", e));

    return jsonOk(
      {
        card: created.card,
        loaded: fromMinorUnits(topUp, Asset.USD),
        charged: fromMinorUnits(charged, Asset.USD),
        message: `Card requested with ${usd(topUp)} loaded. ${usd(charged)} was taken from the user's USD balance. It turns active when Maplerad confirms.`,
      },
      201,
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
