import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { approveTrade, claimTrade, getTradeAdmin, rejectTrade } from "@/lib/giftCards";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { resolveApiOrigin } from "@/lib/kycDocuments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.enum(["claim", "approve", "reject"]),
  reason: z.string().max(300).optional(),
});

/** Admin: one trade with the card code, PIN and photos, for review. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Trade not found", "not_found");
    const trade = await getTradeAdmin(id, resolveApiOrigin(req));
    // Seeing a card's code is sensitive in itself; keep a record of who looked.
    await recordAdminAction(req, actor, {
      action: "admin.giftcard.trade_viewed",
      summary: `Viewed gift card trade (${trade.brandName} ${trade.faceValueFormatted})`,
      userId: trade.userId,
      resourceType: "GiftCardTrade",
      resourceId: id,
    });
    return jsonOk({ trade });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: claim, approve (pays the user — needs a fresh code) or reject a trade. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "Trade not found", "not_found");
    const body = actionSchema.parse(await req.json());

    if (body.action === "claim") {
      await claimTrade(id, actor.email);
      return jsonOk({ ok: true });
    }
    if (body.action === "approve") {
      await requireAdminOtp(req);
      const trade = await approveTrade(id, actor.email);
      await recordAdminAction(req, actor, {
        action: "admin.giftcard.trade_approved",
        summary: `Approved ${trade.brandName} ${trade.faceValueFormatted} — paid ${trade.payoutFormatted}`,
        resourceType: "GiftCardTrade",
        resourceId: id,
        details: { payoutMinor: trade.payoutMinor },
      });
      return jsonOk({ trade });
    }
    const trade = await rejectTrade(id, actor.email, body.reason ?? "");
    await recordAdminAction(req, actor, {
      action: "admin.giftcard.trade_rejected",
      summary: `Rejected ${trade.brandName} ${trade.faceValueFormatted}: ${trade.rejectReason}`,
      resourceType: "GiftCardTrade",
      resourceId: id,
    });
    return jsonOk({ trade });
  } catch (err) {
    return toErrorResponse(err);
  }
}
