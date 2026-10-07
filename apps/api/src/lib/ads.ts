// apps/api/src/lib/ads.ts
//
// CheqPay Ads: self-serve ad campaigns. A verified user (the advertiser) books
// days on in-app placements — the home banner, the success screen after a
// transaction, the Pay bills page — pays for them upfront from their Naira
// balance, and an admin reviews every ad before it runs.
//
// Pricing is a fixed price per placement per day, set by admins. Each
// placement sells a limited number of slots per day; booked slots are rows in
// ad_campaign_slots, one per campaign × channel × day, so availability,
// refunds and delivery are all just status flips on those rows.
//
// Money safety (same model as the gadget store):
//   - prices come from settings on the server, never from the caller;
//   - the debit, the ledger row, the campaign and its slots are written in ONE
//     transaction with a balance floor, and per-channel-day advisory locks so
//     two advertisers can't both buy the last slot;
//   - idempotent on the caller's Idempotency-Key;
//   - a refund flips BOOKED slots to REFUNDED with a guarded UPDATE in the same
//     transaction as the credit, so a slot is refunded at most once.
//
// Targeting is matched at serve time against what CheqPay already knows about
// a user (state from KYC, age band from date of birth, activity segments built
// nightly from their own transactions) plus their coarse location, which is
// only kept when they allow it and "Personalised ads" is on.
//
// Tables are raw SQL created lazily, like giftCards.ts.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { notifyAdmins } from "./adminNotify";
import { notifyUser } from "./alerts";
import { ensureAdTxnTypes } from "./ensureAdTxnTypes";
import { ensureAdsSchema } from "./ensureAds";
import { matchesSignature } from "./fileSignature";
import { ApiError } from "./http";
import { formatNairaMinor } from "./money";
import { cachedSetting, invalidateSetting } from "./settingsCache";

// ---------------------------------------------------------------------------
// Vocabulary

export const PLACEMENTS = ["home", "receipt", "paybills"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const PLACEMENT_LABELS: Record<Placement, string> = {
  home: "Home screen banner",
  receipt: "After a transaction",
  paybills: "Pay bills page",
};

export const AD_CATEGORIES = {
  retail: "Shops & retail",
  food: "Food & drinks",
  fitness: "Fitness & gyms",
  beauty: "Beauty & salons",
  fashion: "Fashion",
  tech: "Tech & gadgets",
  education: "Education",
  events: "Events & entertainment",
  health: "Health",
  services: "Services",
  travel: "Travel & hotels",
  real_estate: "Real estate",
  auto: "Cars & transport",
  betting: "Betting & gaming (18+)",
  alcohol: "Alcohol (18+)",
  other: "Other",
} as const;
export type AdCategory = keyof typeof AD_CATEGORIES;
/** Categories that may only reach adults whose age we know. */
export const ADULT_CATEGORIES: readonly AdCategory[] = ["betting", "alcohol"];

/** Audiences built nightly from each user's own CheqPay activity (last 90 days). */
export const SEGMENTS = {
  bill_payers: "Pay bills (airtime, data, power, TV)",
  crypto_traders: "Buy or sell crypto",
  card_users: "Use dollar cards",
  gadget_buyers: "Bought gadgets",
  event_goers: "Buy event tickets",
  gift_card_sellers: "Sell gift cards",
  senders: "Send money often",
  high_activity: "Very active users",
} as const;
export type Segment = keyof typeof SEGMENTS;

/** Times of day in Lagos. Night wraps past midnight. */
export const DAYPARTS = {
  morning: { label: "Morning (6am–12pm)", from: 6, to: 12 },
  afternoon: { label: "Afternoon (12pm–5pm)", from: 12, to: 17 },
  evening: { label: "Evening (5pm–10pm)", from: 17, to: 22 },
  night: { label: "Night (10pm–6am)", from: 22, to: 6 },
} as const;
export type Daypart = keyof typeof DAYPARTS;

export const PLATFORMS = ["ios", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
] as const;

// ---------------------------------------------------------------------------
// Settings

export interface AdsSettings {
  /** ₦ (kobo) per day for one slot on each placement. */
  placementPriceMinor: Record<Placement, number>;
  /** How many advertisers share a placement on one day (they rotate). */
  slotsPerDay: Record<Placement, number>;
  /** "Promote my venue in Nearby": price per day and how many venues share the top spots. */
  nearbyPriceMinor: number;
  nearbySlotsPerDay: number;
  /** A screen-day only counts (and pays the venue) if a screen was online this many hours. */
  minScreenHours: number;
  /** Longest campaign, in days. */
  maxDays: number;
  /** Targeting that matches fewer people than this is refused. */
  minAudience: number;
  /** Default and highest per-person daily views of one campaign. */
  defaultFrequencyCap: number;
  maxFrequencyCap: number;
}

export const DEFAULT_ADS_SETTINGS: AdsSettings = {
  placementPriceMinor: { home: 500_000, receipt: 300_000, paybills: 200_000 },
  slotsPerDay: { home: 5, receipt: 5, paybills: 5 },
  nearbyPriceMinor: 150_000,
  nearbySlotsPerDay: 20,
  minScreenHours: 4,
  maxDays: 60,
  minAudience: 100,
  defaultFrequencyCap: 3,
  maxFrequencyCap: 5,
};

const SETTINGS_KEY = "ads_settings";

export async function getAdsSettings(): Promise<AdsSettings> {
  return cachedSetting(SETTINGS_KEY, async () => {
    const row = await prisma.platformSetting.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row) return structuredClone(DEFAULT_ADS_SETTINGS);
    try {
      const saved = JSON.parse(row.value) as Partial<AdsSettings>;
      return {
        ...DEFAULT_ADS_SETTINGS,
        ...saved,
        placementPriceMinor: { ...DEFAULT_ADS_SETTINGS.placementPriceMinor, ...(saved.placementPriceMinor ?? {}) },
        slotsPerDay: { ...DEFAULT_ADS_SETTINGS.slotsPerDay, ...(saved.slotsPerDay ?? {}) },
      };
    } catch {
      return structuredClone(DEFAULT_ADS_SETTINGS);
    }
  });
}

export async function setAdsSettings(patch: Partial<AdsSettings>, updatedBy: string): Promise<AdsSettings> {
  const cur = await getAdsSettings();
  const next: AdsSettings = {
    ...cur,
    ...patch,
    placementPriceMinor: { ...cur.placementPriceMinor, ...(patch.placementPriceMinor ?? {}) },
    slotsPerDay: { ...cur.slotsPerDay, ...(patch.slotsPerDay ?? {}) },
  };
  await prisma.platformSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: JSON.stringify(next), updatedBy },
    create: { key: SETTINGS_KEY, value: JSON.stringify(next), updatedBy },
  });
  invalidateSetting(SETTINGS_KEY);
  return next;
}
export { ensureAdsSchema };

// ---------------------------------------------------------------------------
// Dates (Lagos)

export function lagosDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function lagosHour(d: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hour12: false }).format(d)) % 24;
}

export function addDays(day: string, n: number): string {
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}

export function daypartOf(hour: number): Daypart {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

// ---------------------------------------------------------------------------
// Targeting

/** Coarse location kept on the server: ~5 km, never the exact spot. */
export const roundCoord = (v: number) => Math.round(v * 20) / 20;

export const targetingSchema = z.object({
  states: z.array(z.enum(NIGERIAN_STATES)).max(37).default([]),
  radius: z
    .object({ lat: z.number().min(3).max(15), lng: z.number().min(2).max(15), km: z.number().min(1).max(200) })
    .nullable()
    .default(null),
  ageMin: z.number().int().min(13).max(80).default(18),
  ageMax: z.number().int().min(13).max(100).default(65),
  segments: z.array(z.enum(Object.keys(SEGMENTS) as [Segment, ...Segment[]])).max(8).default([]),
  platforms: z.array(z.enum(PLATFORMS)).max(3).default([]),
  newUsersOnly: z.boolean().default(false),
  dayparts: z.array(z.enum(Object.keys(DAYPARTS) as [Daypart, ...Daypart[]])).max(4).default([]),
  frequencyCap: z.number().int().min(1).max(10).default(3),
});
export type Targeting = z.infer<typeof targetingSchema>;

/** What a campaign books: shared by the quote and the purchase routes. */
export const quoteSchema = z.object({
  placements: z.array(z.enum(PLACEMENTS)).max(PLACEMENTS.length).default([]),
  /** Partner venue screens to show on. */
  venues: z.array(z.string().uuid()).max(50).default([]),
  /** "Promote my venue in Nearby": one of the advertiser's own venues. */
  nearbyVenueId: z.string().uuid().nullable().default(null),
  startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(365),
  category: z.enum(Object.keys(AD_CATEGORIES) as [AdCategory, ...AdCategory[]]),
  targeting: targetingSchema,
});

export interface UserAdContext {
  state: string | null;
  city: string | null;
  age: number | null;
  createdAt: Date;
  segments: string[];
  personalised: boolean;
  mutedCategories: string[];
  /** Coarse location, only when allowed and fresh. */
  location: { lat: number; lng: number } | null;
  platform: Platform | null;
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/ state$/, "").replace(/^abuja$|^federal capital territory$/, "fct");

/**
 * Does this campaign's targeting include this person, right now? Pure, so the
 * serving path and the tests share one definition. Returns the reasons it
 * matched, for "Why am I seeing this ad?".
 *
 * A user who turned "Personalised ads" off is matched by state, age and
 * platform only: any campaign that needs their activity, their location or
 * their account age simply doesn't reach them.
 */
export function matchTargeting(
  t: Targeting,
  category: string,
  ctx: UserAdContext,
  now: Date = new Date(),
): { ok: boolean; why: string[] } {
  const no = { ok: false, why: [] };
  const why: string[] = [];
  if (ctx.mutedCategories.includes(category)) return no;

  // Age is a safety rule as much as targeting: adult categories need a known age.
  const adult = ADULT_CATEGORIES.includes(category as AdCategory);
  if (ctx.age === null) {
    if (adult) return no;
  } else {
    if (ctx.age < Math.max(t.ageMin, adult ? 18 : 0) || ctx.age > t.ageMax) return no;
    if (t.ageMin > 18 || t.ageMax < 65) why.push(`Aged ${t.ageMin}–${t.ageMax}`);
  }

  if (t.states.length) {
    const want = t.states.map(norm);
    if (!ctx.state || !want.includes(norm(ctx.state))) return no;
    why.push(ctx.state);
  }

  if (t.platforms.length) {
    if (!ctx.platform || !t.platforms.includes(ctx.platform)) return no;
  }

  if (t.dayparts.length && !t.dayparts.includes(daypartOf(lagosHour(now)))) return no;

  if (t.radius) {
    if (!ctx.personalised || !ctx.location) return no;
    const d = distanceKm(ctx.location, t.radius);
    if (d > t.radius.km) return no;
    why.push(`Near you (within ${t.radius.km} km)`);
  }

  if (t.segments.length) {
    if (!ctx.personalised) return no;
    const hit = t.segments.filter((s) => ctx.segments.includes(s));
    if (!hit.length) return no;
    why.push(...hit.map((s) => SEGMENTS[s as Segment] ?? s));
  }

  if (t.newUsersOnly) {
    if (!ctx.personalised) return no;
    if (now.getTime() - ctx.createdAt.getTime() > 30 * 86_400_000) return no;
    why.push("New to CheqPay");
  }

  if (!why.length) why.push(t.states.length ? "Your state" : "Shown to everyone");
  return { ok: true, why };
}

/** How well a matched campaign fits the person: more matched interests and nearer is better. */
export function relevanceScore(t: Targeting, ctx: UserAdContext): number {
  let score = 1;
  if (t.segments.length) score += 0.5 * t.segments.filter((s) => ctx.segments.includes(s)).length;
  if (t.radius && ctx.location) score += 1 - Math.min(1, distanceKm(ctx.location, t.radius) / t.radius.km);
  if (t.states.length) score += 0.25;
  return score;
}

/**
 * Pacing: a booked day should be spread across the day, not burned in the
 * morning. Campaigns with fewer views so far today (relative to the others)
 * go first; ties break on relevance.
 */
export function rankCampaigns<T extends { id: string; relevance: number; viewsToday: number }>(list: T[]): T[] {
  const score = (c: T) => c.relevance / (1 + c.viewsToday / 50);
  return [...list].sort((a, b) => score(b) - score(a) || b.relevance - a.relevance || a.id.localeCompare(b.id));
}

/**
 * How many people the targeting reaches today (a count, never identities).
 * Platform and time of day aren't knowable in advance, so they don't narrow it.
 */
export async function estimateAudience(t: Targeting, category: string): Promise<number> {
  await ensureAdsSchema();
  const adult = ADULT_CATEGORIES.includes(category as AdCategory);
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n
       FROM app_users u
       LEFT JOIN user_ad_segments s ON s.user_id = u.id
       LEFT JOIN user_ad_prefs p ON p.user_id = u.id
       LEFT JOIN user_ad_location l ON l.user_id = u.id AND l.updated_at > now() - interval '7 days'
      WHERE u.status::text = 'ACTIVE'
        AND NOT ($1 = ANY(coalesce(p.muted_categories, '{}')))
        AND (cardinality($2::text[]) = 0 OR lower(regexp_replace(coalesce(u.address_state, ''), ' state$', '', 'i')) = ANY($2::text[]))
        AND (CASE WHEN u.date_of_birth IS NULL THEN NOT $3::boolean
                  ELSE date_part('year', age(u.date_of_birth)) BETWEEN $4::int AND $5::int END)
        AND (cardinality($6::text[]) = 0 OR (coalesce(p.personalised, true) AND coalesce(s.segments, '{}') && $6::text[]))
        AND (NOT $7::boolean OR (coalesce(p.personalised, true) AND u.created_at > now() - interval '30 days'))
        AND ($8::float8 IS NULL OR (coalesce(p.personalised, true) AND l.lat IS NOT NULL AND
             6371 * 2 * asin(sqrt(power(sin(radians(l.lat - $9::float8) / 2), 2)
               + cos(radians($9::float8)) * cos(radians(l.lat)) * power(sin(radians(l.lng - $10::float8) / 2), 2))) <= $8::float8))`,
    category,
    t.states.map(norm),
    adult,
    Math.max(t.ageMin, adult ? 18 : 0),
    t.ageMax,
    t.segments,
    t.newUsersOnly,
    t.radius?.km ?? null,
    t.radius?.lat ?? 0,
    t.radius?.lng ?? 0,
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Quotes & availability

export interface QuoteLine {
  channel: string;
  label: string;
  perDayMinor: string;
  days: number;
  totalMinor: string;
  totalFormatted: string;
}

export const channelOf = (p: Placement) => `placement:${p}`;

export interface PlannedLine extends QuoteLine {
  /** How many campaigns may book this channel on one day. */
  capacity: number;
}

/**
 * Turn what the advertiser picked into priced lines, one per channel. Prices
 * and capacities come from settings and the venue rows, never the caller.
 */
export async function planChannels(input: {
  placements: Placement[];
  venues?: string[];
  nearbyVenueId?: string | null;
  days: number;
  userId?: string;
}): Promise<{ lines: PlannedLine[]; totalMinor: bigint }> {
  const s = await getAdsSettings();
  const line = (channel: string, label: string, per: bigint, capacity: number): PlannedLine => {
    const total = per * BigInt(input.days);
    return { channel, label, perDayMinor: per.toString(), days: input.days, totalMinor: total.toString(), totalFormatted: formatNairaMinor(total), capacity };
  };
  const lines: PlannedLine[] = [...new Set(input.placements)].map((p) =>
    line(channelOf(p), PLACEMENT_LABELS[p], BigInt(s.placementPriceMinor[p]), s.slotsPerDay[p]),
  );
  const venueIds = [...new Set(input.venues ?? [])];
  if (venueIds.length) {
    await ensureAdsSchema();
    const rows = await prisma.$queryRawUnsafe<{ id: string; name: string; city: string; price_per_day_minor: bigint; max_ads: number }[]>(
      `SELECT v.id::text, v.name, v.city, v.price_per_day_minor, v.max_ads FROM ad_venues v
        WHERE v.id = ANY($1::uuid[]) AND v.active AND v.price_per_day_minor > 0
          AND EXISTS (SELECT 1 FROM ad_screens sc WHERE sc.venue_id = v.id)`,
      venueIds,
    );
    if (rows.length !== venueIds.length) throw new ApiError(422, "One of those screens isn't available any more. Pick again.", "venue_unavailable");
    for (const v of rows) lines.push(line(`venue:${v.id}`, `Screen · ${v.name}${v.city ? `, ${v.city}` : ""}`, BigInt(v.price_per_day_minor), v.max_ads));
  }
  if (input.nearbyVenueId) {
    await ensureAdsSchema();
    const own = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM ad_venues WHERE id = $1::uuid AND active AND ($2::uuid IS NULL OR owner_user_id = $2::uuid)`,
      input.nearbyVenueId, input.userId ?? null,
    );
    if (!own[0]) throw new ApiError(403, "You can only promote a venue you own.", "not_venue_owner");
    lines.push(line(NEARBY_CHANNEL, `Featured in Nearby · ${own[0].name}`, BigInt(s.nearbyPriceMinor), s.nearbySlotsPerDay));
  }
  return { lines, totalMinor: lines.reduce((a, l) => a + BigInt(l.totalMinor), 0n) };
}

export const NEARBY_CHANNEL = "placement:nearby";

/** Back-compat: price for in-app placements only. */
export async function quoteCampaign(placements: Placement[], days: number): Promise<{ lines: QuoteLine[]; totalMinor: bigint }> {
  const { lines, totalMinor } = await planChannels({ placements, days });
  return { lines: lines.map(({ capacity: _c, ...l }) => l), totalMinor };
}

/** Free slots per channel per day for a date range. */
export async function availability(startDay: string, days: number, lines: { channel: string; capacity: number }[]): Promise<Record<string, { day: string; free: number }[]>> {
  await ensureAdsSchema();
  const endDay = addDays(startDay, days - 1);
  const rows = lines.length
    ? await prisma.$queryRawUnsafe<{ channel: string; day: string; n: number }[]>(
        `SELECT channel, to_char(day, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM ad_campaign_slots
          WHERE status IN ('BOOKED', 'DELIVERED') AND day BETWEEN $1::date AND $2::date AND channel = ANY($3::text[])
          GROUP BY channel, day`,
        startDay, endDay, lines.map((l) => l.channel),
      )
    : [];
  const used = new Map(rows.map((r) => [`${r.channel}|${r.day}`, r.n]));
  const out: Record<string, { day: string; free: number }[]> = {};
  for (const l of lines) {
    out[l.channel] = Array.from({ length: days }, (_, i) => {
      const day = addDays(startDay, i);
      return { day, free: Math.max(0, l.capacity - (used.get(`${l.channel}|${day}`) ?? 0)) };
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Creatives

const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_CHARS = 700_000; // ~500KB

/** A user-uploaded ad image: PNG/JPEG/WebP only, and the bytes must really be that type. */
export function assertAdImage(image: string): void {
  const m = IMAGE_RE.exec(image);
  if (!m || image.length > MAX_IMAGE_CHARS) {
    throw new ApiError(422, "Upload a PNG, JPEG or WebP image under 500KB.", "bad_image");
  }
  const bytes = Buffer.from(m[2], "base64");
  if (!matchesSignature(bytes, `image/${m[1]}`)) {
    throw new ApiError(422, "That file isn't a real image. Upload it again.", "bad_image");
  }
}

export function assertAdLink(url: string | null | undefined): void {
  if (!url) return;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ApiError(422, "Enter a full link starting with https://", "bad_link");
  }
  if (u.protocol !== "https:" || !u.hostname.includes(".")) {
    throw new ApiError(422, "Enter a full link starting with https://", "bad_link");
  }
}

// ---------------------------------------------------------------------------
// Campaigns

export const CAMPAIGN_STATUSES = ["PENDING_REVIEW", "APPROVED", "LIVE", "ENDED", "REJECTED", "CANCELLED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

interface CampaignRow {
  id: string;
  user_id: string;
  business_name: string;
  headline: string;
  body: string;
  image: string;
  link_url: string | null;
  cta: string;
  category: string;
  targeting: Targeting;
  start_day: string;
  days: number;
  status: CampaignStatus;
  reason: string | null;
  reviewed_by: string | null;
  paid_minor: bigint;
  refunded_minor: bigint;
  breakdown: QuoteLine[];
  created_at: Date;
}

const campaignCols = (p = "") =>
  `${p}id::text AS id, ${p}user_id::text AS user_id, ${p}business_name, ${p}headline, ${p}body, ${p}image, ${p}link_url, ${p}cta,
   ${p}category, ${p}targeting, to_char(${p}start_day, 'YYYY-MM-DD') AS start_day, ${p}days, ${p}status, ${p}reason,
   ${p}reviewed_by, ${p}paid_minor, ${p}refunded_minor, ${p}breakdown, ${p}created_at`;
const CAMPAIGN_COLS = campaignCols();

export interface CampaignStats {
  views: number;
  clicks: number;
  byChannel: { channel: string; label: string; views: number; clicks: number }[];
  byDay: { day: string; views: number; clicks: number }[];
}

export interface CampaignView {
  id: string;
  businessName: string;
  headline: string;
  body: string;
  image: string;
  linkUrl: string | null;
  cta: string;
  category: string;
  categoryLabel: string;
  targeting: Targeting;
  startDay: string;
  endDay: string;
  days: number;
  status: CampaignStatus;
  reason: string | null;
  placements: Placement[];
  paidFormatted: string;
  refundedFormatted: string;
  breakdown: QuoteLine[];
  createdAt: string;
  stats: CampaignStats;
}

function channelLabel(channel: string): string {
  const p = channel.replace(/^placement:/, "") as Placement;
  return PLACEMENT_LABELS[p] ?? channel;
}

function campaignView(r: CampaignRow, stats: CampaignStats): CampaignView {
  return {
    id: r.id,
    businessName: r.business_name,
    headline: r.headline,
    body: r.body,
    image: r.image,
    linkUrl: r.link_url,
    cta: r.cta,
    category: r.category,
    categoryLabel: AD_CATEGORIES[r.category as AdCategory] ?? r.category,
    targeting: r.targeting,
    startDay: r.start_day,
    endDay: addDays(r.start_day, r.days - 1),
    days: r.days,
    status: r.status,
    reason: r.reason,
    placements: (r.breakdown ?? []).map((l) => l.channel.replace(/^placement:/, "") as Placement).filter((p) => (PLACEMENTS as readonly string[]).includes(p)),
    paidFormatted: formatNairaMinor(BigInt(r.paid_minor)),
    refundedFormatted: formatNairaMinor(BigInt(r.refunded_minor)),
    breakdown: r.breakdown ?? [],
    createdAt: new Date(r.created_at).toISOString(),
    stats,
  };
}

async function statsFor(ids: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>();
  if (!ids.length) return out;
  const rows = await prisma.$queryRawUnsafe<{ campaign_id: string; channel: string; day: string; views: number; clicks: number }[]>(
    `SELECT campaign_id::text, channel, to_char(day, 'YYYY-MM-DD') AS day, views, clicks FROM ad_stats
      WHERE campaign_id = ANY($1::uuid[]) ORDER BY day`,
    ids,
  );
  for (const id of ids) out.set(id, { views: 0, clicks: 0, byChannel: [], byDay: [] });
  for (const r of rows) {
    const s = out.get(r.campaign_id)!;
    s.views += r.views;
    s.clicks += r.clicks;
    let c = s.byChannel.find((x) => x.channel === r.channel);
    if (!c) s.byChannel.push((c = { channel: r.channel, label: channelLabel(r.channel), views: 0, clicks: 0 }));
    c.views += r.views;
    c.clicks += r.clicks;
    let d = s.byDay.find((x) => x.day === r.day);
    if (!d) s.byDay.push((d = { day: r.day, views: 0, clicks: 0 }));
    d.views += r.views;
    d.clicks += r.clicks;
  }
  return out;
}

export interface CreateCampaignInput {
  userId: string;
  idempotencyKey: string;
  businessName: string;
  headline: string;
  body: string;
  image: string;
  linkUrl?: string | null;
  cta?: string;
  category: AdCategory;
  targeting: Targeting;
  placements: Placement[];
  venues?: string[];
  nearbyVenueId?: string | null;
  startDay: string;
  days: number;
}

/** Check the inputs that don't need the database. Shared by quote and create. */
export async function validateCampaignShape(input: Pick<CreateCampaignInput, "placements" | "venues" | "nearbyVenueId" | "startDay" | "days" | "targeting" | "category">): Promise<void> {
  const s = await getAdsSettings();
  if (!input.placements.length && !(input.venues ?? []).length && !input.nearbyVenueId) throw new ApiError(422, "Choose at least one place for your ad.", "no_placements");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDay) || input.startDay < lagosDay()) {
    throw new ApiError(422, "Pick a start date from today onwards.", "bad_start");
  }
  if (input.startDay > addDays(lagosDay(), 90)) throw new ApiError(422, "Start within the next 90 days.", "bad_start");
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > s.maxDays) {
    throw new ApiError(422, `Run for 1 to ${s.maxDays} days.`, "bad_days");
  }
  if (input.targeting.ageMin > input.targeting.ageMax) throw new ApiError(422, "The minimum age is above the maximum.", "bad_age");
  if (ADULT_CATEGORIES.includes(input.category) && input.targeting.ageMin < 18) {
    throw new ApiError(422, "Ads in this category can only reach people aged 18 and over.", "adult_category");
  }
  if (input.targeting.frequencyCap > s.maxFrequencyCap) {
    throw new ApiError(422, `Show each person your ad at most ${s.maxFrequencyCap} times a day.`, "bad_cap");
  }
}

/**
 * Book and pay for a campaign. Money-safe and idempotent; the PIN is checked by
 * the route before this runs. The campaign waits for an admin's review; if it's
 * rejected, everything is refunded.
 */
export async function createCampaign(input: CreateCampaignInput): Promise<CampaignView> {
  await ensureAdsSchema();
  await ensureAdTxnTypes();

  const existing = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `SELECT ${CAMPAIGN_COLS} FROM ad_campaigns WHERE idempotency_key = $1 AND user_id = $2::uuid`, input.idempotencyKey, input.userId,
  );
  if (existing[0]) return campaignView(existing[0], { views: 0, clicks: 0, byChannel: [], byDay: [] });

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { kycTier: true, status: true } });
  if (!user || user.kycTier < 1) {
    throw new ApiError(403, "Verify your identity to advertise on CheqPay.", "kyc_required");
  }

  await validateCampaignShape(input);
  assertAdImage(input.image);
  assertAdLink(input.linkUrl);
  const s = await getAdsSettings();
  // Audience size only matters for in-app ads; screens and Nearby reach whoever is there.
  const audience = input.placements.length ? await estimateAudience(input.targeting, input.category) : Infinity;
  if (audience < s.minAudience) {
    throw new ApiError(422, `Your targeting reaches fewer than ${s.minAudience} people. Widen it a little.`, "audience_too_small");
  }

  const placements = [...new Set(input.placements)];
  const { lines, totalMinor } = await planChannels({ placements, venues: input.venues, nearbyVenueId: input.nearbyVenueId, days: input.days, userId: input.userId });
  const id = randomUUID();

  await prisma.$transaction(async (db) => {
    // Lock every channel-day being bought, in a fixed order, then count what's
    // taken. Two people racing for the last slot serialise here; the second sees it gone.
    const keys = lines.flatMap((l) => Array.from({ length: input.days }, (_, i) => `${l.channel}|${addDays(input.startDay, i)}`)).sort();
    for (const k of keys) await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `ad-slot:${k}`);
    for (const l of lines) {
      const full = await db.$queryRawUnsafe<{ day: string }[]>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day FROM ad_campaign_slots
          WHERE channel = $1 AND status IN ('BOOKED', 'DELIVERED') AND day BETWEEN $2::date AND $3::date
          GROUP BY day HAVING count(*) >= $4`,
        l.channel, input.startDay, addDays(input.startDay, input.days - 1), l.capacity,
      );
      if (l.capacity <= 0 || full.length) {
        throw new ApiError(409, `${l.label} is fully booked${full.length ? ` on ${full.map((f) => f.day).join(", ")}` : ""}. Pick other dates.`, "sold_out");
      }
    }

    const debit = await db.balance.updateMany({
      where: { userId: input.userId, asset: Asset.NGN, available: { gte: totalMinor } },
      data: { available: { decrement: totalMinor } },
    });
    if (debit.count !== 1) throw new ApiError(422, "Insufficient NGN balance", "insufficient_funds");

    await db.transaction.create({
      data: {
        userId: input.userId,
        type: TransactionType.AD_PURCHASE,
        asset: Asset.NGN,
        amount: totalMinor,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: input.idempotencyKey,
        metadata: { kind: "ad", campaignId: id, headline: input.headline, days: input.days, channels: lines.map((l) => l.channel) },
      },
    });

    await db.$executeRawUnsafe(
      `INSERT INTO ad_campaigns (id, user_id, business_name, headline, body, image, link_url, cta, category, targeting,
         start_day, days, paid_minor, breakdown, idempotency_key, promoted_venue_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::date, $12, $13, $14::jsonb, $15, $16::uuid)`,
      id, input.userId, input.businessName.trim(), input.headline.trim(), input.body.trim(), input.image,
      input.linkUrl || null, (input.cta || "Learn more").trim(), input.category, JSON.stringify(input.targeting),
      input.startDay, input.days, totalMinor, JSON.stringify(lines.map(({ capacity: _c, ...l }) => l)), input.idempotencyKey,
      input.nearbyVenueId ?? null,
    );
    for (const l of lines) {
      await db.$executeRawUnsafe(
        `INSERT INTO ad_campaign_slots (campaign_id, channel, day, price_minor)
         SELECT $1::uuid, $2, d::date, $3 FROM generate_series($4::date, $5::date, interval '1 day') AS d`,
        id, l.channel, BigInt(l.perDayMinor), input.startDay, addDays(input.startDay, input.days - 1),
      );
    }
    await db.auditLog.create({
      data: {
        userId: input.userId,
        action: "ad.campaign.created",
        resourceType: "AdCampaign",
        resourceId: id,
        details: { channels: lines.map((l) => l.channel), days: input.days, startDay: input.startDay, totalMinor: totalMinor.toString(), category: input.category },
      },
    });
  });

  const view = (await getCampaign(id))!;
  void notifyUser(input.userId, {
    category: "updates",
    emailKind: "money_out",
    title: "Ad sent for review",
    body: `We're reviewing "${view.headline}". It runs from ${view.startDay} once approved — if it isn't, you get every naira back.`,
    amount: view.paidFormatted,
    data: { adCampaignId: id, url: "/advertise/campaigns/" },
    details: [
      { label: "Runs", value: `${view.startDay} → ${view.endDay} (${view.days} day${view.days === 1 ? "" : "s"})` },
      { label: "Paid", value: view.paidFormatted },
    ],
  }).catch(() => undefined);
  void notifyAdmins({
    title: "New ad to review",
    body: `${view.businessName}: "${view.headline}" · ${view.paidFormatted} · starts ${view.startDay}`,
    rows: [["Business", view.businessName], ["Headline", view.headline], ["Category", view.categoryLabel], ["Starts", view.startDay], ["Paid", view.paidFormatted]],
    where: "Ads",
    emailSubject: `New ad to review: ${view.businessName}`,
    data: { adCampaignId: id, kind: "admin_ad_review" },
    icon: "📣",
  }).catch(() => undefined);
  return view;
}

export async function getCampaign(id: string): Promise<CampaignView | null> {
  await ensureAdsSchema();
  const rows = await prisma.$queryRawUnsafe<CampaignRow[]>(`SELECT ${CAMPAIGN_COLS} FROM ad_campaigns WHERE id = $1::uuid`, id);
  if (!rows[0]) return null;
  return campaignView(rows[0], (await statsFor([id])).get(id)!);
}

export async function listUserCampaigns(userId: string): Promise<CampaignView[]> {
  await ensureAdsSchema();
  const rows = await prisma.$queryRawUnsafe<CampaignRow[]>(
    `SELECT ${CAMPAIGN_COLS} FROM ad_campaigns WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 100`, userId,
  );
  const stats = await statsFor(rows.map((r) => r.id));
  return rows.map((r) => campaignView(r, stats.get(r.id)!));
}

/**
 * Refund every BOOKED slot of a campaign that matches `where` (SQL on the slot
 * row, e.g. "day > $2"). Guarded flip + credit + ledger row in one
 * transaction, so a slot is refunded once however often this runs.
 */
export async function refundSlots(campaignId: string, where: string, params: unknown[], reason: string, nextStatus?: CampaignStatus): Promise<bigint> {
  await ensureAdTxnTypes();
  return prisma.$transaction(async (db) => {
    const owner = await db.$queryRawUnsafe<{ user_id: string }[]>(`SELECT user_id::text FROM ad_campaigns WHERE id = $1::uuid FOR UPDATE`, campaignId);
    if (!owner[0]) throw new ApiError(404, "Campaign not found", "not_found");
    const flipped = await db.$queryRawUnsafe<{ price_minor: bigint }[]>(
      `UPDATE ad_campaign_slots SET status = 'REFUNDED' WHERE campaign_id = $1::uuid AND status = 'BOOKED' AND (${where}) RETURNING price_minor`,
      campaignId, ...params,
    );
    const amount = flipped.reduce((a, r) => a + BigInt(r.price_minor), 0n);
    if (nextStatus) {
      await db.$executeRawUnsafe(`UPDATE ad_campaigns SET status = $2, updated_at = now() WHERE id = $1::uuid`, campaignId, nextStatus);
    }
    if (amount > 0n) {
      await db.balance.upsert({
        where: { userId_asset: { userId: owner[0].user_id, asset: Asset.NGN } },
        update: { available: { increment: amount } },
        create: { userId: owner[0].user_id, asset: Asset.NGN, available: amount },
      });
      await db.transaction.create({
        data: {
          userId: owner[0].user_id,
          type: TransactionType.AD_REFUND,
          asset: Asset.NGN,
          amount,
          status: TransactionStatus.COMPLETED,
          idempotencyKey: `ad-refund:${campaignId}:${randomUUID()}`,
          metadata: { kind: "ad_refund", campaignId, reason, slots: flipped.length },
        },
      });
      await db.$executeRawUnsafe(`UPDATE ad_campaigns SET refunded_minor = refunded_minor + $2, updated_at = now() WHERE id = $1::uuid`, campaignId, amount);
    }
    return amount;
  });
}

/** The advertiser stops their campaign: days that haven't started are refunded. */
export async function cancelCampaign(userId: string, id: string): Promise<CampaignView> {
  await ensureAdsSchema();
  const c = (await prisma.$queryRawUnsafe<CampaignRow[]>(`SELECT ${CAMPAIGN_COLS} FROM ad_campaigns WHERE id = $1::uuid AND user_id = $2::uuid`, id, userId))[0];
  if (!c) throw new ApiError(404, "Campaign not found", "not_found");
  if (!["PENDING_REVIEW", "APPROVED", "LIVE"].includes(c.status)) throw new ApiError(409, "This campaign has already finished.", "not_cancellable");
  // Not yet running → everything back. Running → today has been shown; the rest comes back.
  const fromDay = c.status === "LIVE" ? addDays(lagosDay(), 1) : "1970-01-01";
  const amount = await refundSlots(id, `day >= $2::date`, [fromDay], "cancelled", "CANCELLED");
  const view = (await getCampaign(id))!;
  void notifyUser(userId, {
    category: "updates",
    emailKind: "money_in",
    title: "Ad stopped",
    body: amount > 0n ? `"${view.headline}" is stopped. ${formatNairaMinor(amount)} for the days it didn't run is back in your balance.` : `"${view.headline}" is stopped.`,
    amount: formatNairaMinor(amount),
    data: { adCampaignId: id, url: "/advertise/campaigns/" },
  }).catch(() => undefined);
  return view;
}

// ---------------------------------------------------------------------------
// Admin review

export async function listCampaignsAdmin(status: CampaignStatus | "ALL"): Promise<(CampaignView & { userId: string; advertiserEmail: string | null; advertiserName: string | null; audience: number | null })[]> {
  await ensureAdsSchema();
  const rows = await prisma.$queryRawUnsafe<(CampaignRow & { email: string | null; legal_name: string | null })[]>(
    `SELECT ${campaignCols("c.")}, u.email, u.legal_name
       FROM ad_campaigns c JOIN app_users u ON u.id = c.user_id
      WHERE ($1 = 'ALL' OR c.status = $1)
      ORDER BY CASE WHEN c.status = 'PENDING_REVIEW' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`,
    status,
  );
  const stats = await statsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...campaignView(r, stats.get(r.id)!), userId: r.user_id, advertiserEmail: r.email, advertiserName: r.legal_name, audience: null }));
}

/**
 * Approve or reject a campaign under review. Approval makes it LIVE straight
 * away if it has started (any days that already passed while it waited are
 * refunded); rejection refunds everything.
 */
export async function decideCampaign(id: string, approve: boolean, reason: string | null, admin: string): Promise<CampaignView> {
  await ensureAdsSchema();
  const today = lagosDay();
  const flipped = await prisma.$queryRawUnsafe<{ user_id: string; start_day: string }[]>(
    `UPDATE ad_campaigns SET status = $2, reason = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
      WHERE id = $1::uuid AND status = 'PENDING_REVIEW' RETURNING user_id::text, to_char(start_day, 'YYYY-MM-DD') AS start_day`,
    id, approve ? "APPROVED" : "REJECTED", approve ? null : reason, admin,
  );
  if (!flipped[0]) throw new ApiError(409, "This campaign has already been decided.", "already_decided");
  const userId = flipped[0].user_id;

  if (approve) {
    const missed = await refundSlots(id, `day < $2::date`, [today], "missed_while_in_review");
    if (flipped[0].start_day <= today) {
      await prisma.$executeRawUnsafe(`UPDATE ad_campaigns SET status = 'LIVE', updated_at = now() WHERE id = $1::uuid AND status = 'APPROVED'`, id);
    }
    const view = (await getCampaign(id))!;
    void notifyUser(userId, {
      category: "updates",
      emailKind: "money_out",
      title: "Your ad is approved",
      body: `"${view.headline}" ${view.status === "LIVE" ? "is live now" : `goes live on ${view.startDay}`}.${missed > 0n ? ` ${formatNairaMinor(missed)} for days that passed during review is back in your balance.` : ""}`,
      data: { adCampaignId: id, url: "/advertise/campaigns/" },
    }).catch(() => undefined);
    return view;
  }

  const amount = await refundSlots(id, "true", [], "rejected");
  const view = (await getCampaign(id))!;
  void notifyUser(userId, {
    category: "updates",
    emailKind: "money_in",
    title: "Your ad wasn't approved",
    body: `"${view.headline}" wasn't approved: ${reason}. ${formatNairaMinor(amount)} is back in your balance.`,
    amount: formatNairaMinor(amount),
    data: { adCampaignId: id, url: "/advertise/campaigns/" },
  }).catch(() => undefined);
  return view;
}

// ---------------------------------------------------------------------------
// Privacy preferences

export interface AdPrefs {
  personalised: boolean;
  mutedCategories: string[];
}

export async function getAdPrefs(userId: string): Promise<AdPrefs> {
  await ensureAdsSchema();
  const rows = await prisma.$queryRawUnsafe<{ personalised: boolean; muted_categories: string[] }[]>(
    `SELECT personalised, muted_categories FROM user_ad_prefs WHERE user_id = $1::uuid`, userId,
  );
  return { personalised: rows[0]?.personalised ?? true, mutedCategories: rows[0]?.muted_categories ?? [] };
}

export async function setAdPrefs(userId: string, prefs: AdPrefs): Promise<AdPrefs> {
  await ensureAdsSchema();
  const muted = prefs.mutedCategories.filter((c) => c in AD_CATEGORIES).slice(0, 20);
  await prisma.$executeRawUnsafe(
    `INSERT INTO user_ad_prefs (user_id, personalised, muted_categories) VALUES ($1::uuid, $2, $3::text[])
     ON CONFLICT (user_id) DO UPDATE SET personalised = EXCLUDED.personalised, muted_categories = EXCLUDED.muted_categories, updated_at = now()`,
    userId, prefs.personalised, muted,
  );
  // Turning personalisation off forgets the location we held.
  if (!prefs.personalised) await prisma.$executeRawUnsafe(`DELETE FROM user_ad_location WHERE user_id = $1::uuid`, userId);
  return { personalised: prefs.personalised, mutedCategories: muted };
}

// ---------------------------------------------------------------------------
// Serving

export interface ServedAd {
  campaignId: string;
  channel: string;
  businessName: string;
  headline: string;
  body: string;
  image: string;
  linkUrl: string | null;
  cta: string;
  why: string[];
}

async function loadUserContext(userId: string, platform: Platform | null, loc: { lat: number; lng: number } | null): Promise<UserAdContext | null> {
  const rows = await prisma.$queryRawUnsafe<{
    address_state: string | null; address_city: string | null; age: number | null; created_at: Date;
    segments: string[] | null; personalised: boolean | null; muted_categories: string[] | null;
    lat: number | null; lng: number | null;
  }[]>(
    `SELECT u.address_state, u.address_city,
            CASE WHEN u.date_of_birth IS NULL THEN NULL ELSE date_part('year', age(u.date_of_birth))::int END AS age,
            u.created_at, s.segments, p.personalised, p.muted_categories, l.lat, l.lng
       FROM app_users u
       LEFT JOIN user_ad_segments s ON s.user_id = u.id
       LEFT JOIN user_ad_prefs p ON p.user_id = u.id
       LEFT JOIN user_ad_location l ON l.user_id = u.id AND l.updated_at > now() - interval '7 days'
      WHERE u.id = $1::uuid AND u.status::text = 'ACTIVE'`,
    userId,
  );
  const r = rows[0];
  if (!r) return null;
  const personalised = r.personalised ?? true;
  let location = personalised && r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null;
  if (personalised && loc) {
    location = { lat: roundCoord(loc.lat), lng: roundCoord(loc.lng) };
    await prisma.$executeRawUnsafe(
      `INSERT INTO user_ad_location (user_id, lat, lng) VALUES ($1::uuid, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now()`,
      userId, location.lat, location.lng,
    );
  }
  return {
    state: r.address_state,
    city: r.address_city,
    age: r.age,
    createdAt: new Date(r.created_at),
    segments: r.segments ?? [],
    personalised,
    mutedCategories: r.muted_categories ?? [],
    location,
    platform,
  };
}

/** The best ad for this person on this placement right now, or null. */
export async function serveAd(input: {
  userId: string;
  placement: Placement;
  platform: Platform | null;
  location: { lat: number; lng: number } | null;
}): Promise<ServedAd | null> {
  await ensureAdsSchema();
  const today = lagosDay();
  const channel = channelOf(input.placement);
  const candidates = await prisma.$queryRawUnsafe<(CampaignRow & { views_today: number; my_views: number })[]>(
    `SELECT ${campaignCols("c.")},
            coalesce(st.views, 0) AS views_today, coalesce(v.n, 0) AS my_views
       FROM ad_campaigns c
       JOIN ad_campaign_slots sl ON sl.campaign_id = c.id AND sl.channel = $1 AND sl.day = $2::date AND sl.status IN ('BOOKED', 'DELIVERED')
       LEFT JOIN ad_stats st ON st.campaign_id = c.id AND st.channel = $1 AND st.day = $2::date
       LEFT JOIN ad_user_views v ON v.campaign_id = c.id AND v.user_id = $3::uuid AND v.day = $2::date
      WHERE c.status = 'LIVE' AND c.user_id <> $3::uuid
      LIMIT 50`,
    channel, today, input.userId,
  );
  if (!candidates.length) return null;
  const ctx = await loadUserContext(input.userId, input.platform, input.location);
  if (!ctx) return null;

  const now = new Date();
  const eligible = candidates
    .map((c) => {
      const t = targetingSchema.parse(c.targeting ?? {});
      if (c.my_views >= t.frequencyCap) return null;
      const m = matchTargeting(t, c.category, ctx, now);
      if (!m.ok) return null;
      return { id: c.id, row: c, why: m.why, relevance: relevanceScore(t, ctx), viewsToday: c.views_today };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const best = rankCampaigns(eligible)[0];
  if (!best) return null;
  const c = best.row;
  return {
    campaignId: c.id,
    channel,
    businessName: c.business_name,
    headline: c.headline,
    body: c.body,
    image: c.image,
    linkUrl: c.link_url,
    cta: c.cta,
    why: best.why,
  };
}

/** A person saw or tapped an ad. Counts once per call; the route rate-limits. */
export async function recordAdEvent(userId: string | null, campaignId: string, channel: string, kind: "view" | "click"): Promise<boolean> {
  await ensureAdsSchema();
  const today = lagosDay();
  const live = await prisma.$queryRawUnsafe<{ ok: number }[]>(
    `SELECT 1 AS ok FROM ad_campaigns c JOIN ad_campaign_slots s ON s.campaign_id = c.id AND s.channel = $2 AND s.day = $3::date
      WHERE c.id = $1::uuid AND c.status = 'LIVE' LIMIT 1`,
    campaignId, channel, today,
  );
  if (!live.length) return false;
  const col = kind === "click" ? "clicks" : "views";
  await prisma.$executeRawUnsafe(
    `INSERT INTO ad_stats (campaign_id, channel, day, ${col}) VALUES ($1::uuid, $2, $3::date, 1)
     ON CONFLICT (campaign_id, channel, day) DO UPDATE SET ${col} = ad_stats.${col} + 1`,
    campaignId, channel, today,
  );
  if (kind === "view" && userId) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ad_user_views (campaign_id, user_id, day, n) VALUES ($1::uuid, $2::uuid, $3::date, 1)
       ON CONFLICT (campaign_id, user_id, day) DO UPDATE SET n = ad_user_views.n + 1`,
      campaignId, userId, today,
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Daily run (cron)

/**
 * Once a day (and safe to run again):
 *   1. rebuild everyone's activity segments from the last 90 days;
 *   2. forget locations older than 7 days and per-person view counts older than 3;
 *   3. mark yesterday's and earlier in-app slots of running campaigns delivered;
 *   4. refund days of campaigns nobody reviewed before they passed;
 *   5. move campaigns APPROVED → LIVE on their start day, and LIVE → ENDED after their last.
 */
export async function runAdsDaily(): Promise<{ segments: number; delivered: number; ended: number; started: number; expiredRefunds: number }> {
  await ensureAdsSchema();
  const today = lagosDay();

  const segments = await prisma.$executeRawUnsafe(`
    INSERT INTO user_ad_segments (user_id, segments, updated_at)
    SELECT t.user_id,
           array_remove(ARRAY[
             CASE WHEN count(*) FILTER (WHERE t.type::text = 'BILL') > 0 THEN 'bill_payers' END,
             CASE WHEN count(*) FILTER (WHERE t.type::text IN ('BUY', 'SELL', 'CONVERT')) > 0 THEN 'crypto_traders' END,
             CASE WHEN count(*) FILTER (WHERE t.type::text IN ('CARD_FUND', 'CARD_ISSUE')) > 0 THEN 'card_users' END,
             CASE WHEN count(*) FILTER (WHERE t.type::text = 'GADGET_PURCHASE') > 0 THEN 'gadget_buyers' END,
             CASE WHEN count(*) FILTER (WHERE t.type::text = 'TICKET_PURCHASE') > 0 THEN 'event_goers' END,
             CASE WHEN count(*) FILTER (WHERE t.type::text = 'GIFTCARD_SELL') > 0 THEN 'gift_card_sellers' END,
             CASE WHEN count(*) FILTER (WHERE t.type::text = 'TRANSFER_OUT') >= 3 THEN 'senders' END,
             CASE WHEN count(*) >= 20 THEN 'high_activity' END
           ]::text[], NULL),
           now()
      FROM ledger_transactions t
     WHERE t.status::text = 'COMPLETED' AND t.created_at > now() - interval '90 days'
     GROUP BY t.user_id
    ON CONFLICT (user_id) DO UPDATE SET segments = EXCLUDED.segments, updated_at = now()`);
  await prisma.$executeRawUnsafe(`UPDATE user_ad_segments SET segments = '{}' WHERE updated_at < now() - interval '2 days'`);
  await prisma.$executeRawUnsafe(`DELETE FROM user_ad_location WHERE updated_at < now() - interval '7 days'`);
  await prisma.$executeRawUnsafe(`DELETE FROM ad_user_views WHERE day < $1::date`, addDays(today, -3));

  const started = await prisma.$executeRawUnsafe(
    `UPDATE ad_campaigns SET status = 'LIVE', updated_at = now() WHERE status = 'APPROVED' AND start_day <= $1::date`, today,
  );
  const delivered = await prisma.$executeRawUnsafe(
    `UPDATE ad_campaign_slots s SET status = 'DELIVERED' FROM ad_campaigns c
      WHERE c.id = s.campaign_id AND c.status IN ('LIVE', 'ENDED', 'CANCELLED') AND s.status = 'BOOKED' AND s.day < $1::date
        AND s.channel LIKE 'placement:%'`,
    today,
  );

  // Campaigns still waiting for review whose days have passed: refund those days.
  let expiredRefunds = 0;
  const waiting = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT DISTINCT c.id::text FROM ad_campaigns c JOIN ad_campaign_slots s ON s.campaign_id = c.id
      WHERE c.status = 'PENDING_REVIEW' AND s.status = 'BOOKED' AND s.day < $1::date`,
    today,
  );
  for (const w of waiting) {
    if ((await refundSlots(w.id, `day < $2::date`, [today], "missed_while_in_review")) > 0n) expiredRefunds++;
  }
  await prisma.$executeRawUnsafe(
    `UPDATE ad_campaigns c SET status = 'REJECTED', reason = 'Not reviewed before its last day — fully refunded.', updated_at = now()
      WHERE c.status = 'PENDING_REVIEW' AND NOT EXISTS (SELECT 1 FROM ad_campaign_slots s WHERE s.campaign_id = c.id AND s.status = 'BOOKED')`,
  );

  const ended = await prisma.$queryRawUnsafe<{ id: string; user_id: string; headline: string }[]>(
    `UPDATE ad_campaigns c SET status = 'ENDED', updated_at = now()
      WHERE c.status = 'LIVE' AND NOT EXISTS (SELECT 1 FROM ad_campaign_slots s WHERE s.campaign_id = c.id AND s.day >= $1::date AND s.status = 'BOOKED')
      RETURNING c.id::text, c.user_id::text, c.headline`,
    today,
  );
  for (const e of ended) {
    const st = (await statsFor([e.id])).get(e.id)!;
    void notifyUser(e.user_id, {
      category: "updates",
      title: "Your ad has finished",
      body: `"${e.headline}" was seen ${st.views.toLocaleString("en-NG")} times and tapped ${st.clicks.toLocaleString("en-NG")} times.`,
      data: { adCampaignId: e.id, url: "/advertise/campaigns/" },
    }).catch(() => undefined);
  }
  return { segments, delivered, ended: ended.length, started, expiredRefunds };
}
