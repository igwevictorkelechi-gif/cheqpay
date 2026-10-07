import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { NIGERIAN_STATES } from "@/lib/ads";
import { VENUE_CATEGORIES, listVenuesAdmin, upsertVenue, type VenueCategory } from "@/lib/adsVenues";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { imageValue } from "@/lib/uploadedImage";

export const dynamic = "force-dynamic";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().or(z.literal("").transform(() => null));
const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  category: z.enum(Object.keys(VENUE_CATEGORIES) as [VenueCategory, ...VenueCategory[]]),
  description: z.string().max(300).default(""),
  photo: imageValue.nullable().default(null),
  address: z.string().max(200).default(""),
  city: z.string().max(80).default(""),
  state: z.enum(NIGERIAN_STATES),
  location: z.string().max(500).nullable().default(null),
  opens: hhmm.default(null),
  closes: hhmm.default(null),
  ownerEmail: z.string().email().nullable().or(z.literal("").transform(() => null)).default(null),
  pricePerDay: z.number().min(0).max(10_000_000),
  sharePercent: z.number().min(0).max(100),
  maxAds: z.number().int().min(1).max(30),
  listed: z.boolean(),
  active: z.boolean(),
});

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    return jsonOk({ venues: await listVenuesAdmin(), categories: VENUE_CATEGORIES, states: NIGERIAN_STATES });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Add or edit a partner venue. Sets who gets paid and how much, so it needs a fresh code. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const b = schema.parse(await req.json());
    const id = await upsertVenue({
      ...b,
      photo: b.photo || null,
      pricePerDayMinor: BigInt(Math.round(b.pricePerDay * 100)),
      shareBps: Math.round(b.sharePercent * 100),
    });
    await recordAdminAction(req, actor, {
      action: b.id ? "admin.ads.venue_updated" : "admin.ads.venue_created",
      summary: `Venue "${b.name}" ${b.id ? "updated" : "added"} (₦${b.pricePerDay}/day, ${b.sharePercent}% to owner)`,
      resourceType: "AdVenue",
      resourceId: id,
      details: { ...b, photo: b.photo ? "(image)" : null },
    });
    return jsonOk({ id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
