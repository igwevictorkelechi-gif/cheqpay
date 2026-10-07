// apps/api/src/lib/adsVenues.ts
//
// Partner venues (gyms, restaurants, stores…) for CheqPay Ads.
//
// A venue shows ads on one or more screens: a TV, Android box or tablet that
// opens mycheqpay.com/screen full-screen. A new screen asks for a 6-digit code;
// an admin types that code against the venue to pair it. From then on the
// screen authenticates with its own secret token (only a hash is stored),
// fetches today's playlist and reports a heartbeat every minute.
//
// Money: advertisers book a venue per day (price set per venue). After the day
// ends, the daily run looks at that venue's uptime. If a screen was online for
// at least the minimum hours, the slot is DELIVERED and the venue owner is paid
// their share into their CheqPay balance; if not, the advertiser gets that
// day back. Each slot flips once, under a guarded UPDATE, in the same
// transaction as the money, and payouts are unique per slot — safe to re-run.
//
// Venues are also recommended to users in "Nearby", sorted by distance from
// their coarse location (or their state), with a venue's own ad pinned when
// it has booked "Featured in Nearby".

import { createHash, randomBytes, randomInt } from "node:crypto";
import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { notifyUser } from "./alerts";
import {
  NEARBY_CHANNEL,
  daypartOf,
  distanceKm,
  ensureAdsSchema,
  getAdsSettings,
  lagosDay,
  lagosHour,
  refundSlots,
  roundCoord,
  targetingSchema,
} from "./ads";
import { ensureAdTxnTypes } from "./ensureAdTxnTypes";
import { ApiError } from "./http";
import { formatNairaMinor } from "./money";

export const VENUE_CATEGORIES = {
  gym: "Gyms & fitness",
  restaurant: "Restaurants",
  cafe: "Cafés & lounges",
  bar: "Bars & clubs",
  store: "Shops & supermarkets",
  salon: "Salons & spas",
  hotel: "Hotels",
  mall: "Malls",
  coworking: "Co-working",
  pharmacy: "Pharmacies",
  other: "Other places",
} as const;
export type VenueCategory = keyof typeof VENUE_CATEGORIES;

/** A screen counts as online if it reported in within this long. */
const ONLINE_MS = 3 * 60_000;

// ---------------------------------------------------------------------------
// Venues

interface VenueRow {
  id: string;
  name: string;
  category: string;
  description: string;
  photo: string | null;
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  opens: string | null;
  closes: string | null;
  owner_user_id: string | null;
  price_per_day_minor: bigint;
  share_bps: number;
  max_ads: number;
  listed: boolean;
  active: boolean;
  created_at: Date;
}

const VENUE_COLS = `v.id::text AS id, v.name, v.category, v.description, v.photo, v.address, v.city, v.state, v.lat, v.lng,
  v.opens, v.closes, v.owner_user_id::text AS owner_user_id, v.price_per_day_minor, v.share_bps, v.max_ads, v.listed, v.active, v.created_at`;

/** "HH:MM" opens/closes in Lagos time; closes past midnight wraps. Unknown hours count as open. */
export function isOpenNow(opens: string | null, closes: string | null, now: Date = new Date()): boolean | null {
  if (!opens || !closes || !/^\d{2}:\d{2}$/.test(opens) || !/^\d{2}:\d{2}$/.test(closes)) return null;
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const lagos = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const n = mins(lagos.replace(/^24/, "00")), o = mins(opens), c = mins(closes);
  return o <= c ? n >= o && n < c : n >= o || n < c;
}

/** Pull coordinates out of a Google Maps link or a plain "lat, lng". */
export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  const s = input.trim();
  const patterns = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

export interface VenueInput {
  id?: string;
  name: string;
  category: VenueCategory;
  description: string;
  photo: string | null;
  address: string;
  city: string;
  state: string;
  location: string | null;
  opens: string | null;
  closes: string | null;
  ownerEmail: string | null;
  pricePerDayMinor: bigint;
  shareBps: number;
  maxAds: number;
  listed: boolean;
  active: boolean;
}

export async function upsertVenue(input: VenueInput): Promise<string> {
  await ensureAdsSchema();
  const coords = input.location ? parseCoordinates(input.location) : null;
  if (input.location && !coords) throw new ApiError(422, "Paste a Google Maps link or coordinates like 6.5244, 3.3792.", "bad_location");
  let ownerId: string | null = null;
  if (input.ownerEmail) {
    const u = await prisma.user.findFirst({ where: { email: { equals: input.ownerEmail.trim(), mode: "insensitive" } }, select: { id: true } });
    if (!u) throw new ApiError(404, "No CheqPay account with that owner email.", "owner_not_found");
    ownerId = u.id;
  }
  const params = [
    input.name.trim(), input.category, input.description.trim(), input.photo || null, input.address.trim(), input.city.trim(), input.state.trim(),
    coords?.lat ?? null, coords?.lng ?? null, input.opens || null, input.closes || null, ownerId, input.pricePerDayMinor,
    input.shareBps, input.maxAds, input.listed, input.active,
  ];
  if (input.id) {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE ad_venues SET name = $2, category = $3, description = $4, photo = $5, address = $6, city = $7, state = $8,
         lat = COALESCE($9, lat), lng = COALESCE($10, lng), opens = $11, closes = $12, owner_user_id = $13::uuid,
         price_per_day_minor = $14, share_bps = $15, max_ads = $16, listed = $17, active = $18, updated_at = now()
       WHERE id = $1::uuid`,
      input.id, ...params,
    );
    if (!n) throw new ApiError(404, "Venue not found", "not_found");
    return input.id;
  }
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO ad_venues (name, category, description, photo, address, city, state, lat, lng, opens, closes, owner_user_id,
       price_per_day_minor, share_bps, max_ads, listed, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, $13, $14, $15, $16, $17) RETURNING id::text`,
    ...params,
  );
  return rows[0].id;
}

interface ScreenRow {
  id: string;
  venue_id: string | null;
  label: string;
  last_seen_at: Date | null;
  paired_at: Date | null;
}

export async function listVenuesAdmin() {
  await ensureAdsSchema();
  const today = lagosDay();
  const venues = await prisma.$queryRawUnsafe<(VenueRow & { owner_email: string | null; earned: bigint | null; minutes_today: number | null })[]>(
    `SELECT ${VENUE_COLS}, u.email AS owner_email,
            (SELECT sum(amount_minor) FROM ad_payouts p WHERE p.venue_id = v.id)::bigint AS earned,
            (SELECT max(minutes) FROM ad_screen_uptime up JOIN ad_screens sc ON sc.id = up.screen_id WHERE sc.venue_id = v.id AND up.day = $1::date) AS minutes_today
       FROM ad_venues v LEFT JOIN app_users u ON u.id = v.owner_user_id
      ORDER BY v.created_at DESC`,
    today,
  );
  const screens = await prisma.$queryRawUnsafe<ScreenRow[]>(
    `SELECT id::text, venue_id::text, label, last_seen_at, paired_at FROM ad_screens WHERE venue_id IS NOT NULL ORDER BY paired_at`,
  );
  const now = Date.now();
  return venues.map((v) => ({
    id: v.id,
    name: v.name,
    category: v.category,
    description: v.description,
    photo: v.photo,
    address: v.address,
    city: v.city,
    state: v.state,
    lat: v.lat,
    lng: v.lng,
    opens: v.opens,
    closes: v.closes,
    ownerEmail: v.owner_email,
    pricePerDay: Number(v.price_per_day_minor) / 100,
    sharePercent: v.share_bps / 100,
    maxAds: v.max_ads,
    listed: v.listed,
    active: v.active,
    earnedFormatted: formatNairaMinor(BigInt(v.earned ?? 0)),
    minutesToday: v.minutes_today ?? 0,
    screens: screens
      .filter((s) => s.venue_id === v.id)
      .map((s) => ({ id: s.id, label: s.label, online: !!s.last_seen_at && now - new Date(s.last_seen_at).getTime() < ONLINE_MS, lastSeenAt: s.last_seen_at?.toISOString() ?? null })),
  }));
}

/** Screens an advertiser can book: active venues with a price and at least one paired screen. */
export async function listBookableVenues(state: string | null) {
  await ensureAdsSchema();
  const rows = await prisma.$queryRawUnsafe<(VenueRow & { online: boolean; screens: number })[]>(
    `SELECT ${VENUE_COLS},
            EXISTS (SELECT 1 FROM ad_screens sc WHERE sc.venue_id = v.id AND sc.last_seen_at > now() - interval '3 minutes') AS online,
            (SELECT count(*)::int FROM ad_screens sc WHERE sc.venue_id = v.id) AS screens
       FROM ad_venues v
      WHERE v.active AND v.price_per_day_minor > 0 AND EXISTS (SELECT 1 FROM ad_screens sc WHERE sc.venue_id = v.id)
        AND ($1::text IS NULL OR lower(v.state) = lower($1))
      ORDER BY v.state, v.city, v.name LIMIT 200`,
    state,
  );
  return rows.map((v) => ({
    id: v.id,
    name: v.name,
    category: v.category,
    categoryLabel: VENUE_CATEGORIES[v.category as VenueCategory] ?? v.category,
    city: v.city,
    state: v.state,
    photo: v.photo,
    perDayMinor: String(v.price_per_day_minor),
    perDayFormatted: formatNairaMinor(BigInt(v.price_per_day_minor)),
    screens: v.screens,
    online: v.online,
  }));
}

/** Venues this user owns (for "Promote my venue in Nearby"). */
export async function listOwnedVenues(userId: string) {
  await ensureAdsSchema();
  const rows = await prisma.$queryRawUnsafe<{ id: string; name: string; city: string }[]>(
    `SELECT id::text, name, city FROM ad_venues WHERE owner_user_id = $1::uuid AND active ORDER BY name`, userId,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Screens: pairing, playlist, heartbeat

/** A screen sends `Authorization: Screen <token>`. */
export function screenToken(req: Request): string | null {
  const [scheme, token] = (req.headers.get("authorization") ?? "").split(" ");
  return scheme === "Screen" && token ? token : null;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** A fresh screen asks for a pairing code. Returns its secret token once. */
export async function newScreen(): Promise<{ token: string; code: string; expiresAt: string }> {
  await ensureAdsSchema();
  const token = randomBytes(32).toString("base64url");
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      const rows = await prisma.$queryRawUnsafe<{ pair_expires: Date }[]>(
        `INSERT INTO ad_screens (pair_code, pair_expires, token_hash) VALUES ($1, now() + interval '30 minutes', $2) RETURNING pair_expires`,
        code, hashToken(token),
      );
      return { token, code, expiresAt: rows[0].pair_expires.toISOString() };
    } catch {
      // code collision — try another
    }
  }
  throw new ApiError(503, "Couldn't create a pairing code. Reload the page.", "pair_code_failed");
}

async function screenFor(token: string | null): Promise<ScreenRow & { pair_code: string | null; pair_expires: Date | null }> {
  if (!token || token.length < 20) throw new ApiError(401, "Unknown screen", "screen_unknown");
  await ensureAdsSchema();
  const rows = await prisma.$queryRawUnsafe<(ScreenRow & { pair_code: string | null; pair_expires: Date | null })[]>(
    `SELECT id::text, venue_id::text, label, last_seen_at, paired_at, pair_code, pair_expires FROM ad_screens WHERE token_hash = $1`,
    hashToken(token),
  );
  if (!rows[0]) throw new ApiError(401, "Unknown screen", "screen_unknown");
  return rows[0];
}

/** An admin pairs the screen showing `code` with a venue. */
export async function pairScreen(venueId: string, code: string, label: string): Promise<{ screenId: string }> {
  await ensureAdsSchema();
  const venue = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text FROM ad_venues WHERE id = $1::uuid`, venueId);
  if (!venue[0]) throw new ApiError(404, "Venue not found", "not_found");
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE ad_screens SET venue_id = $1::uuid, label = $3, pair_code = NULL, pair_expires = NULL, paired_at = now()
      WHERE pair_code = $2 AND pair_expires > now() AND venue_id IS NULL RETURNING id::text`,
    venueId, code.trim(), label.trim().slice(0, 60),
  );
  if (!rows[0]) throw new ApiError(404, "That code isn't showing on any screen (or it expired). Reload the screen to get a new one.", "bad_pair_code");
  return { screenId: rows[0].id };
}

export async function unpairScreen(screenId: string): Promise<void> {
  await ensureAdsSchema();
  await prisma.$executeRawUnsafe(`DELETE FROM ad_screens WHERE id = $1::uuid`, screenId);
}

export interface PlaylistItem {
  campaignId: string;
  businessName: string;
  headline: string;
  body: string;
  image: string;
  linkUrl: string | null;
  cta: string;
}

/** What a screen should show now. Unpaired screens get their pairing code instead. */
export async function screenState(token: string | null): Promise<
  | { paired: false; code: string | null; expiresAt: string | null }
  | { paired: true; venue: { id: string; name: string; city: string }; playlist: PlaylistItem[]; refreshSeconds: number }
> {
  const sc = await screenFor(token);
  if (!sc.venue_id) {
    return { paired: false, code: sc.pair_expires && sc.pair_expires > new Date() ? sc.pair_code : null, expiresAt: sc.pair_expires?.toISOString() ?? null };
  }
  const venue = (await prisma.$queryRawUnsafe<{ id: string; name: string; city: string; active: boolean }[]>(
    `SELECT id::text, name, city, active FROM ad_venues WHERE id = $1::uuid`, sc.venue_id,
  ))[0];
  if (!venue) return { paired: false, code: null, expiresAt: null };
  const today = lagosDay();
  const rows = venue.active
    ? await prisma.$queryRawUnsafe<{ id: string; business_name: string; headline: string; body: string; image: string; link_url: string | null; cta: string; targeting: unknown }[]>(
        `SELECT c.id::text, c.business_name, c.headline, c.body, c.image, c.link_url, c.cta, c.targeting
           FROM ad_campaigns c JOIN ad_campaign_slots s ON s.campaign_id = c.id
          WHERE s.channel = $1 AND s.day = $2::date AND s.status IN ('BOOKED', 'DELIVERED') AND c.status = 'LIVE'
          ORDER BY c.created_at`,
        `venue:${venue.id}`, today,
      )
    : [];
  const part = daypartOf(lagosHour());
  const playlist = rows
    .filter((r) => {
      const t = targetingSchema.safeParse(r.targeting ?? {});
      return !t.success || !t.data.dayparts.length || t.data.dayparts.includes(part);
    })
    .map((r) => ({ campaignId: r.id, businessName: r.business_name, headline: r.headline, body: r.body, image: r.image, linkUrl: r.link_url, cta: r.cta }));
  return { paired: true, venue: { id: venue.id, name: venue.name, city: venue.city }, playlist, refreshSeconds: 300 };
}

/**
 * A screen reports in (about once a minute). Counts one minute of uptime at
 * most every 50 seconds, and the plays since the last report as ad views.
 */
export async function heartbeat(token: string | null, plays: { campaignId: string; n: number }[]): Promise<{ ok: true }> {
  const sc = await screenFor(token);
  await prisma.$executeRawUnsafe(`UPDATE ad_screens SET last_seen_at = now() WHERE id = $1::uuid`, sc.id);
  if (!sc.venue_id) return { ok: true };
  const today = lagosDay();
  const counted = await prisma.$executeRawUnsafe(
    `INSERT INTO ad_screen_uptime (screen_id, day, minutes, plays, last_beat) VALUES ($1::uuid, $2::date, 1, 0, now())
     ON CONFLICT (screen_id, day) DO UPDATE SET minutes = ad_screen_uptime.minutes + 1, last_beat = now()
       WHERE ad_screen_uptime.last_beat IS NULL OR ad_screen_uptime.last_beat < now() - interval '50 seconds'`,
    sc.id, today,
  );
  if (!counted) return { ok: true };
  const channel = `venue:${sc.venue_id}`;
  const valid = plays.filter((p) => /^[0-9a-f-]{36}$/i.test(p.campaignId) && p.n > 0).slice(0, 30);
  let total = 0;
  for (const p of valid) {
    const n = Math.min(Math.trunc(p.n), 20); // a minute can't hold more than ~6 ten-second plays; be generous, never unbounded
    const ok = await prisma.$executeRawUnsafe(
      `INSERT INTO ad_stats (campaign_id, channel, day, views)
       SELECT $1::uuid, $2, $3::date, $4 WHERE EXISTS (
         SELECT 1 FROM ad_campaign_slots s WHERE s.campaign_id = $1::uuid AND s.channel = $2 AND s.day = $3::date)
       ON CONFLICT (campaign_id, channel, day) DO UPDATE SET views = ad_stats.views + EXCLUDED.views`,
      p.campaignId, channel, today, n,
    );
    if (ok) total += n;
  }
  if (total) await prisma.$executeRawUnsafe(`UPDATE ad_screen_uptime SET plays = plays + $3 WHERE screen_id = $1::uuid AND day = $2::date`, sc.id, today, total);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settlement (daily)

/**
 * Settle every venue-day before today that is still BOOKED on a campaign that
 * ran. Online long enough → DELIVERED and the owner's share paid; otherwise
 * refunded to the advertiser. Safe to run any number of times.
 */
export async function settleVenueDays(): Promise<{ delivered: number; refunded: number; paidOut: number }> {
  await ensureAdsSchema();
  await ensureAdTxnTypes();
  const s = await getAdsSettings();
  const today = lagosDay();
  const due = await prisma.$queryRawUnsafe<{ id: string; campaign_id: string; channel: string; day: string; price_minor: bigint; minutes: number | null }[]>(
    `SELECT s.id::text, s.campaign_id::text, s.channel, to_char(s.day, 'YYYY-MM-DD') AS day, s.price_minor,
            (SELECT max(up.minutes) FROM ad_screen_uptime up JOIN ad_screens sc ON sc.id = up.screen_id
              WHERE sc.venue_id = substring(s.channel from 7)::uuid AND up.day = s.day) AS minutes
       FROM ad_campaign_slots s JOIN ad_campaigns c ON c.id = s.campaign_id
      WHERE s.channel LIKE 'venue:%' AND s.status = 'BOOKED' AND s.day < $1::date AND c.status IN ('LIVE', 'ENDED', 'CANCELLED')
      ORDER BY s.day LIMIT 2000`,
    today,
  );
  let delivered = 0, refunded = 0, paidOut = 0;
  for (const slot of due) {
    if ((slot.minutes ?? 0) >= s.minScreenHours * 60) {
      const result = await prisma.$transaction(async (db) => {
        const flipped = await db.$executeRawUnsafe(`UPDATE ad_campaign_slots SET status = 'DELIVERED' WHERE id = $1::uuid AND status = 'BOOKED'`, slot.id);
        if (!flipped) return { flipped: false, payout: null };
        const venueId = slot.channel.slice(6);
        const v = (await db.$queryRawUnsafe<{ owner_user_id: string | null; share_bps: number; name: string }[]>(
          `SELECT owner_user_id::text, share_bps, name FROM ad_venues WHERE id = $1::uuid`, venueId,
        ))[0];
        if (!v?.owner_user_id || v.share_bps <= 0) return { flipped: true, payout: null };
        const amount = (BigInt(slot.price_minor) * BigInt(v.share_bps)) / 10_000n;
        if (amount <= 0n) return { flipped: true, payout: null };
        await db.$executeRawUnsafe(
          `INSERT INTO ad_payouts (slot_id, venue_id, owner_user_id, amount_minor) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)`,
          slot.id, venueId, v.owner_user_id, amount,
        );
        await db.balance.upsert({
          where: { userId_asset: { userId: v.owner_user_id, asset: Asset.NGN } },
          update: { available: { increment: amount } },
          create: { userId: v.owner_user_id, asset: Asset.NGN, available: amount },
        });
        await db.transaction.create({
          data: {
            userId: v.owner_user_id,
            type: TransactionType.AD_PAYOUT,
            asset: Asset.NGN,
            amount,
            status: TransactionStatus.COMPLETED,
            idempotencyKey: `ad-venue:${slot.id}`,
            metadata: { kind: "ad_venue_payout", venueId, venueName: v.name, day: slot.day, campaignId: slot.campaign_id },
          },
        });
        return { flipped: true, payout: { owner: v.owner_user_id, amount, name: v.name } };
      });
      if (result.flipped) delivered++;
      const payout = result.payout;
      if (payout) {
        paidOut++;
        void notifyUser(payout.owner, {
          category: "deposits",
          emailKind: "money_in",
          title: "Your screen earned money",
          body: `${formatNairaMinor(payout.amount)} for showing ads at ${payout.name} on ${slot.day}.`,
          amount: formatNairaMinor(payout.amount),
          data: { url: "/transactions/" },
        }).catch(() => undefined);
      }
    } else {
      const back = await refundSlots(slot.campaign_id, `id = $2::uuid`, [slot.id], "screen_offline");
      if (back > 0n) refunded++;
    }
  }
  return { delivered, refunded, paidOut };
}

// ---------------------------------------------------------------------------
// Nearby (for users)

export interface NearbyVenue {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  description: string;
  photo: string | null;
  address: string;
  city: string;
  state: string;
  distanceKm: number | null;
  openNow: boolean | null;
  hours: string | null;
  mapsUrl: string | null;
  featured: boolean;
  offer: { campaignId: string; headline: string; body: string; image: string; linkUrl: string | null; cta: string } | null;
}

/**
 * Partner venues for a person: nearest first when we have their rough
 * location, otherwise those in their state. A venue that booked "Featured in
 * Nearby" is pinned to the top for people inside its chosen radius (or state).
 */
export async function nearbyVenues(input: {
  userId: string;
  location: { lat: number; lng: number } | null;
  category: string | null;
}): Promise<{ venues: NearbyVenue[]; basis: "location" | "state" | "all" }> {
  await ensureAdsSchema();
  const me = (await prisma.$queryRawUnsafe<{ address_state: string | null; personalised: boolean | null; lat: number | null; lng: number | null }[]>(
    `SELECT u.address_state, p.personalised, l.lat, l.lng FROM app_users u
       LEFT JOIN user_ad_prefs p ON p.user_id = u.id
       LEFT JOIN user_ad_location l ON l.user_id = u.id AND l.updated_at > now() - interval '7 days'
      WHERE u.id = $1::uuid`,
    input.userId,
  ))[0];
  const personalised = me?.personalised ?? true;
  let loc = personalised ? (input.location ?? (me?.lat != null && me?.lng != null ? { lat: me.lat, lng: me.lng } : null)) : null;
  if (personalised && input.location) {
    loc = { lat: roundCoord(input.location.lat), lng: roundCoord(input.location.lng) };
    await prisma.$executeRawUnsafe(
      `INSERT INTO user_ad_location (user_id, lat, lng) VALUES ($1::uuid, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now()`,
      input.userId, loc.lat, loc.lng,
    );
  }
  const state = me?.address_state?.replace(/ state$/i, "").trim() || null;
  const rows = await prisma.$queryRawUnsafe<VenueRow[]>(
    `SELECT ${VENUE_COLS} FROM ad_venues v
      WHERE v.active AND v.listed AND ($1::text IS NULL OR v.category = $1)
      LIMIT 500`,
    input.category,
  );
  const today = lagosDay();
  const offers = await prisma.$queryRawUnsafe<{ venue_id: string; id: string; headline: string; body: string; image: string; link_url: string | null; cta: string; targeting: unknown }[]>(
    `SELECT c.promoted_venue_id::text AS venue_id, c.id::text, c.headline, c.body, c.image, c.link_url, c.cta, c.targeting
       FROM ad_campaigns c JOIN ad_campaign_slots s ON s.campaign_id = c.id
      WHERE c.status = 'LIVE' AND c.promoted_venue_id IS NOT NULL AND s.channel = $1 AND s.day = $2::date AND s.status IN ('BOOKED', 'DELIVERED')`,
    NEARBY_CHANNEL, today,
  );
  const offerBy = new Map(offers.map((o) => [o.venue_id, o]));

  let basis: "location" | "state" | "all" = loc ? "location" : state ? "state" : "all";
  let list = rows.map((v) => {
    const d = loc && v.lat !== null && v.lng !== null ? distanceKm(loc, { lat: v.lat, lng: v.lng }) : null;
    const o = offerBy.get(v.id);
    let featured = false;
    if (o) {
      const t = targetingSchema.safeParse(o.targeting ?? {});
      const radiusKm = t.success && t.data.radius ? t.data.radius.km : 15;
      featured = d !== null ? d <= radiusKm : !!state && v.state.toLowerCase() === state.toLowerCase();
    }
    return {
      id: v.id,
      name: v.name,
      category: v.category,
      categoryLabel: VENUE_CATEGORIES[v.category as VenueCategory] ?? v.category,
      description: v.description,
      photo: v.photo,
      address: v.address,
      city: v.city,
      state: v.state,
      distanceKm: d === null ? null : Math.round(d * 10) / 10,
      openNow: isOpenNow(v.opens, v.closes),
      hours: v.opens && v.closes ? `${v.opens}–${v.closes}` : null,
      mapsUrl: v.lat !== null && v.lng !== null ? `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}` : v.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.name} ${v.address} ${v.city}`)}` : null,
      featured,
      offer: o ? { campaignId: o.id, headline: o.headline, body: o.body, image: o.image, linkUrl: o.link_url, cta: o.cta } : null,
    };
  });
  if (basis === "location") {
    list = list.filter((v) => v.distanceKm === null || v.distanceKm <= 50);
  } else if (basis === "state") {
    const inState = list.filter((v) => v.state.toLowerCase() === state!.toLowerCase());
    if (inState.length) list = inState;
    else basis = "all";
  }
  list.sort((a, b) => Number(b.featured) - Number(a.featured) || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.name.localeCompare(b.name));
  return { venues: list.slice(0, 30), basis };
}

/** Someone saw (or tapped into) a venue in Nearby — venue owners see the interest. */
export async function recordVenueEvent(venueId: string, kind: "view" | "tap", campaignId: string | null, userId: string | null): Promise<void> {
  await ensureAdsSchema();
  const today = lagosDay();
  const col = kind === "tap" ? "taps" : "views";
  await prisma.$executeRawUnsafe(
    `INSERT INTO ad_venue_stats (venue_id, day, ${col}) SELECT $1::uuid, $2::date, 1 WHERE EXISTS (SELECT 1 FROM ad_venues WHERE id = $1::uuid)
     ON CONFLICT (venue_id, day) DO UPDATE SET ${col} = ad_venue_stats.${col} + 1`,
    venueId, today,
  );
  if (campaignId) {
    const statCol = kind === "tap" ? "clicks" : "views";
    await prisma.$executeRawUnsafe(
      `INSERT INTO ad_stats (campaign_id, channel, day, ${statCol})
       SELECT $1::uuid, $2, $3::date, 1 WHERE EXISTS (
         SELECT 1 FROM ad_campaigns c JOIN ad_campaign_slots s ON s.campaign_id = c.id
          WHERE c.id = $1::uuid AND c.promoted_venue_id = $4::uuid AND s.channel = $2 AND s.day = $3::date AND c.status = 'LIVE')
       ON CONFLICT (campaign_id, channel, day) DO UPDATE SET ${statCol} = ad_stats.${statCol} + 1`,
      campaignId, NEARBY_CHANNEL, today, venueId,
    );
    if (kind === "view" && userId) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO ad_user_views (campaign_id, user_id, day, n) SELECT $1::uuid, $2::uuid, $3::date, 1
          WHERE EXISTS (SELECT 1 FROM ad_campaigns WHERE id = $1::uuid)
         ON CONFLICT (campaign_id, user_id, day) DO UPDATE SET n = ad_user_views.n + 1`,
        campaignId, userId, today,
      );
    }
  }
}
