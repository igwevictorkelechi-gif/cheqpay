import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { CARD_COUNTRIES, CARD_TYPES, listCatalogAdmin, upsertRate } from "@/lib/giftCards";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const rateSchema = z.object({
  brandId: z.string().uuid(),
  country: z.string().refine((c) => c in CARD_COUNTRIES, "Unknown country"),
  cardType: z.enum(CARD_TYPES),
  /** ₦ paid per 1 unit of the card's currency, e.g. 1250 = ₦1,250 per $1. */
  rate: z.number().positive().max(100_000),
  minValue: z.number().int().min(1).max(100_000),
  maxValue: z.number().int().min(1).max(100_000),
  active: z.boolean().default(true),
});

/** Admin: every brand with all its rates (active or not). */
export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    return jsonOk({ brands: await listCatalogAdmin(), countries: CARD_COUNTRIES });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Admin: set the rate for one brand × country × type. Rates decide payouts, so it needs a fresh code. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const body = rateSchema.parse(await req.json());
    const id = await upsertRate(
      { ...body, rateMinor: BigInt(Math.round(body.rate * 100)) },
      actor.email,
    );
    await recordAdminAction(req, actor, {
      action: "admin.giftcard.rate_set",
      summary: `Gift card rate ${body.country} ${body.cardType} = ₦${body.rate}/unit (${body.active ? "on" : "off"})`,
      resourceType: "GiftCardRate",
      resourceId: id,
      details: body,
    });
    return jsonOk({ id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
