import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { ensureCardsTable } from "@/lib/ensureCards";
import { getCardTransactions } from "@/lib/maplerad/issuing";

export const dynamic = "force-dynamic";

/** A card's own spending history, straight from the provider. Owner only. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireUser(req);
    await ensureCardsTable();

    const card = await prisma.card.findFirst({
      where: { id: params.id, userId: auth.id },
      select: { providerCardId: true },
    });
    if (!card) throw new ApiError(404, "Card not found", "not_found");
    if (!card.providerCardId) return jsonOk({ transactions: [] });

    const raw = await getCardTransactions(card.providerCardId, { pageSize: 50 });
    const transactions = raw.map((t) => ({
      id: t.id,
      amountMinor: Number.isFinite(t.amount) ? String(t.amount) : null,
      currency: t.currency ?? "USD",
      description: t.description ?? null,
      status: t.status ?? null,
      entry: t.entry ?? null,
      merchant: t.merchant?.name ?? null,
      createdAt: t.created_at ?? null,
    }));
    return jsonOk({ transactions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
