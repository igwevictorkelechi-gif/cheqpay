import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { ensureCardsTable } from "@/lib/ensureCards";

export const dynamic = "force-dynamic";

/** Fetch one of the user's cards. Status is kept current by the issuing webhook. */
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
        createdAt: true,
      },
    });
    if (!card) throw new ApiError(404, "Card not found", "not_found");
    return jsonOk({ card });
  } catch (err) {
    return toErrorResponse(err);
  }
}
