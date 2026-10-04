import { requireAdminActor } from "@/lib/adminGuard";
import { TRADE_STATUSES, type TradeStatus, listTradesAdmin } from "@/lib/giftCards";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin: the review queue. ?status=OPEN (default, oldest first) | SUBMITTED | IN_REVIEW | APPROVED | REJECTED | ALL */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    const s = (new URL(req.url).searchParams.get("status") ?? "OPEN").toUpperCase();
    const status = s === "ALL" ? undefined : s === "OPEN" ? "OPEN" : (TRADE_STATUSES as readonly string[]).includes(s) ? (s as TradeStatus) : "OPEN";
    return jsonOk(await listTradesAdmin(status));
  } catch (err) {
    return toErrorResponse(err);
  }
}
