import { requireUser } from "@/lib/auth";
import { assertFeatureEnabled } from "@/lib/features";
import { CARD_COUNTRIES, listSellCatalog } from "@/lib/giftCards";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The cards we're buying right now, with the ₦ rate for each country and type. */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    await assertFeatureEnabled("gift_cards_sell");
    return jsonOk({ brands: await listSellCatalog(), countries: CARD_COUNTRIES });
  } catch (err) {
    return toErrorResponse(err);
  }
}
