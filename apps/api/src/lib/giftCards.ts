// apps/api/src/lib/giftCards.ts
//
// Gift card trade-in ("sell"): a user trades a card they own (Amazon, Apple,
// Steam…) for Naira. There is no provider — the operations team checks every
// card by hand — so a trade is a request the user submits and an admin
// approves or rejects. Only an approval moves money, and it moves it once.
//
// Money safety:
//   - the rate is read from the database on the server and LOCKED onto the
//     trade when it is submitted, so the user is paid exactly what they were
//     shown, however rates change while the card waits in the queue;
//   - approval flips the trade's status with a guarded UPDATE (only from
//     SUBMITTED / IN_REVIEW) in the SAME transaction that credits the balance
//     and writes the ledger row, so a double click or two admins approving at
//     once pay once — the second update changes zero rows and rolls back;
//   - submissions are idempotent on the caller's Idempotency-Key.
//
// Card codes and PINs are secrets worth money. They are encrypted at rest
// (encryptPii), never logged, and only ever decrypted for the owner and for a
// reviewing admin. Card photos live in our own Postgres table, reached only
// through short-lived signed URLs — the same model as KYC documents.
//
// The tables are created lazily here and are NOT Prisma models: they are new
// tables nothing else selects, so adding them can't break existing queries.

import { randomUUID } from "node:crypto";
import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { notifyAdmins } from "./adminNotify";
import { notifyUser } from "./alerts";
import { ensureGiftCardTxnTypes } from "./ensureGiftCardTxnTypes";
import { ApiError } from "./http";
import { formatNairaMinor } from "./money";
import { decryptPii, encryptPii, fingerprintMatches, fingerprintPii } from "./pii";

export const CARD_TYPES = ["PHYSICAL", "ECODE"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const TRADE_STATUSES = ["SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED"] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

/** Countries a card can be from, and the currency its face value is in. */
export const CARD_COUNTRIES: Record<string, { name: string; currency: string; symbol: string }> = {
  US: { name: "United States", currency: "USD", symbol: "$" },
  GB: { name: "United Kingdom", currency: "GBP", symbol: "£" },
  CA: { name: "Canada", currency: "CAD", symbol: "C$" },
  AU: { name: "Australia", currency: "AUD", symbol: "A$" },
  EU: { name: "Europe", currency: "EUR", symbol: "€" },
  DE: { name: "Germany", currency: "EUR", symbol: "€" },
  FR: { name: "France", currency: "EUR", symbol: "€" },
  NZ: { name: "New Zealand", currency: "NZD", symbol: "NZ$" },
  CH: { name: "Switzerland", currency: "CHF", symbol: "CHF " },
};

/** Brands offered out of the box; admins add, rename or switch them off. */
const DEFAULT_BRANDS = [
  "Amazon", "Apple / iTunes", "Steam", "Google Play", "Razer Gold", "Sephora", "eBay",
  "Nordstrom", "Walmart", "Vanilla Visa", "Xbox", "PlayStation", "Nike", "Footlocker",
];

/** Per-user guard rails, so one account can't flood the queue. */
export const DAILY_TRADE_LIMIT = 10;
export const MAX_FILES_PER_TRADE = 6;
const FILE_MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Schema

let ensured: Promise<void> | null = null;
export function ensureGiftCardSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS gift_card_brands (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL,
          slug text NOT NULL UNIQUE,
          logo_url text,
          active boolean NOT NULL DEFAULT true,
          sort integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS gift_card_rates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          brand_id uuid NOT NULL REFERENCES gift_card_brands(id) ON DELETE CASCADE,
          country text NOT NULL,
          card_type text NOT NULL CHECK (card_type IN ('PHYSICAL', 'ECODE')),
          currency text NOT NULL,
          rate_minor bigint NOT NULL CHECK (rate_minor > 0),
          min_value integer NOT NULL DEFAULT 10,
          max_value integer NOT NULL DEFAULT 500,
          active boolean NOT NULL DEFAULT true,
          updated_by text,
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (brand_id, country, card_type)
        )`);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS gift_card_files (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL,
          content_type text NOT NULL,
          data bytea NOT NULL,
          trade_id uuid,
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS gift_card_trades (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          brand_id uuid REFERENCES gift_card_brands(id) ON DELETE SET NULL,
          brand_name text NOT NULL,
          country text NOT NULL,
          card_type text NOT NULL,
          currency text NOT NULL,
          face_value integer NOT NULL,
          rate_minor bigint NOT NULL,
          payout_minor bigint NOT NULL,
          code_enc text,
          pin_enc text,
          file_ids uuid[] NOT NULL DEFAULT '{}',
          note text,
          status text NOT NULL DEFAULT 'SUBMITTED'
            CHECK (status IN ('SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED')),
          reject_reason text,
          claimed_by text,
          claimed_at timestamptz,
          reviewed_by text,
          reviewed_at timestamptz,
          transaction_id uuid,
          idempotency_key text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS gift_card_trades_user_idx ON gift_card_trades(user_id, created_at DESC)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS gift_card_trades_status_idx ON gift_card_trades(status, created_at)`,
      );
      // Seed the usual brands once, so the admin only has to add rates.
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM gift_card_brands`);
      if (Number(n) === 0) {
        for (const [i, name] of DEFAULT_BRANDS.entries()) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO gift_card_brands (name, slug, sort) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`,
            name,
            slugify(name),
            i,
          );
        }
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "brand";
}

/** ₦ payout in kobo for a face value at a rate of `rateMinor` kobo per unit. */
export function payoutMinor(faceValue: number, rateMinor: bigint): bigint {
  return BigInt(Math.trunc(faceValue)) * rateMinor;
}

// ---------------------------------------------------------------------------
// Catalog

interface BrandRow { id: string; name: string; slug: string; logo_url: string | null; active: boolean; sort: number }
interface RateRow {
  id: string; brand_id: string; country: string; card_type: CardType; currency: string;
  rate_minor: bigint; min_value: number; max_value: number; active: boolean; updated_by: string | null; updated_at: Date;
}

export interface RateView {
  id: string;
  country: string;
  countryName: string;
  cardType: CardType;
  currency: string;
  symbol: string;
  /** ₦ per 1 unit of the card's currency, in kobo, as a string. */
  rateMinor: string;
  rateFormatted: string;
  minValue: number;
  maxValue: number;
  active: boolean;
}
export interface BrandView {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  active: boolean;
  rates: RateView[];
}

function rateView(r: RateRow): RateView {
  const c = CARD_COUNTRIES[r.country];
  return {
    id: r.id,
    country: r.country,
    countryName: c?.name ?? r.country,
    cardType: r.card_type,
    currency: r.currency,
    symbol: c?.symbol ?? "",
    rateMinor: r.rate_minor.toString(),
    rateFormatted: formatNairaMinor(r.rate_minor),
    minValue: r.min_value,
    maxValue: r.max_value,
    active: r.active,
  };
}

async function loadCatalog(activeOnly: boolean): Promise<BrandView[]> {
  await ensureGiftCardSchema();
  const brands = await prisma.$queryRawUnsafe<BrandRow[]>(
    `SELECT id::text, name, slug, logo_url, active, sort FROM gift_card_brands
      ${activeOnly ? "WHERE active" : ""} ORDER BY sort, name`,
  );
  const rates = await prisma.$queryRawUnsafe<RateRow[]>(
    `SELECT id::text, brand_id::text, country, card_type, currency, rate_minor, min_value, max_value, active, updated_by, updated_at
       FROM gift_card_rates ${activeOnly ? "WHERE active" : ""} ORDER BY country, card_type`,
  );
  return brands
    .map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      logoUrl: b.logo_url,
      active: b.active,
      rates: rates.filter((r) => r.brand_id === b.id).map(rateView),
    }))
    // The storefront only shows brands someone can actually sell right now.
    .filter((b) => !activeOnly || b.rates.length > 0);
}

/** What a user can sell right now: active brands with at least one active rate. */
export function listSellCatalog(): Promise<BrandView[]> {
  return loadCatalog(true);
}

/** Everything, for the admin rate editor. */
export function listCatalogAdmin(): Promise<BrandView[]> {
  return loadCatalog(false);
}

export async function upsertBrand(input: { id?: string; name: string; logoUrl?: string | null; active?: boolean; sort?: number }): Promise<string> {
  await ensureGiftCardSchema();
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new ApiError(422, "Give the brand a name.", "bad_brand");
  if (input.id) {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE gift_card_brands SET name = $2, logo_url = $3, active = COALESCE($4, active), sort = COALESCE($5, sort) WHERE id = $1::uuid`,
      input.id, name, input.logoUrl ?? null, input.active ?? null, input.sort ?? null,
    );
    if (!n) throw new ApiError(404, "Brand not found", "not_found");
    return input.id;
  }
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO gift_card_brands (name, slug, logo_url, active, sort) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, active = true RETURNING id::text`,
    name, slugify(name), input.logoUrl ?? null, input.active ?? true, input.sort ?? 100,
  );
  return rows[0].id;
}

export async function upsertRate(
  input: { brandId: string; country: string; cardType: CardType; rateMinor: bigint; minValue: number; maxValue: number; active: boolean },
  admin: string,
): Promise<string> {
  await ensureGiftCardSchema();
  const country = CARD_COUNTRIES[input.country];
  if (!country) throw new ApiError(422, "Unknown country", "bad_country");
  if (input.rateMinor <= 0n) throw new ApiError(422, "The rate must be above zero.", "bad_rate");
  if (input.minValue < 1 || input.maxValue < input.minValue) {
    throw new ApiError(422, "Check the minimum and maximum card values.", "bad_limits");
  }
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO gift_card_rates (brand_id, country, card_type, currency, rate_minor, min_value, max_value, active, updated_by, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (brand_id, country, card_type) DO UPDATE SET
       rate_minor = EXCLUDED.rate_minor, min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
       active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING id::text`,
    input.brandId, input.country, input.cardType, country.currency, input.rateMinor,
    input.minValue, input.maxValue, input.active, admin,
  );
  return rows[0].id;
}

export async function deleteRate(id: string): Promise<void> {
  await ensureGiftCardSchema();
  await prisma.$executeRawUnsafe(`DELETE FROM gift_card_rates WHERE id = $1::uuid`, id);
}

// ---------------------------------------------------------------------------
// Card photos

const FILE_TOKEN_DOMAIN = "gcfile";

export async function storeGiftCardFile(userId: string, bytes: Buffer, contentType: string): Promise<string> {
  if (bytes.length === 0) throw new ApiError(400, "That image is empty.", "bad_image");
  if (bytes.length > FILE_MAX_BYTES) throw new ApiError(413, "Please upload an image under 5 MB.", "image_too_large");
  await ensureGiftCardSchema();
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO gift_card_files (id, user_id, content_type, data) VALUES ($1::uuid, $2::uuid, $3, $4)`,
    id, userId, contentType, bytes,
  );
  return id;
}

export async function readGiftCardFile(id: string): Promise<{ contentType: string; data: Buffer } | null> {
  await ensureGiftCardSchema();
  const rows = await prisma.$queryRawUnsafe<{ content_type: string; data: Buffer }[]>(
    `SELECT content_type, data FROM gift_card_files WHERE id = $1::uuid`, id,
  );
  return rows[0] ? { contentType: rows[0].content_type, data: Buffer.from(rows[0].data) } : null;
}

export function signGiftCardFileUrl(id: string, ttlSeconds: number, origin: string): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = fingerprintPii(`${FILE_TOKEN_DOMAIN}:${id}:${exp}`);
  return `${origin.replace(/\/$/, "")}/api/giftcards/files/${id}?exp=${exp}&sig=${sig}`;
}

export function verifyGiftCardFileToken(id: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  try {
    return fingerprintMatches(sig, fingerprintPii(`${FILE_TOKEN_DOMAIN}:${id}:${exp}`));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Trades

interface TradeRow {
  id: string; user_id: string; brand_name: string; country: string; card_type: CardType; currency: string;
  face_value: number; rate_minor: bigint; payout_minor: bigint; code_enc: string | null; pin_enc: string | null;
  file_ids: string[]; note: string | null; status: TradeStatus; reject_reason: string | null;
  claimed_by: string | null; reviewed_by: string | null; reviewed_at: Date | null; transaction_id: string | null;
  created_at: Date; updated_at: Date;
}

const TRADE_COLS = `id::text, user_id::text, brand_name, country, card_type, currency, face_value, rate_minor, payout_minor,
  code_enc, pin_enc, file_ids::text[] AS file_ids, note, status, reject_reason, claimed_by, reviewed_by, reviewed_at,
  transaction_id::text, created_at, updated_at`;

export interface TradeView {
  id: string;
  brandName: string;
  country: string;
  countryName: string;
  cardType: CardType;
  currency: string;
  faceValue: number;
  faceValueFormatted: string;
  rateFormatted: string;
  payoutMinor: string;
  payoutFormatted: string;
  status: TradeStatus;
  rejectReason: string | null;
  hasCode: boolean;
  photos: number;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

function tradeView(t: TradeRow): TradeView {
  const c = CARD_COUNTRIES[t.country];
  return {
    id: t.id,
    brandName: t.brand_name,
    country: t.country,
    countryName: c?.name ?? t.country,
    cardType: t.card_type,
    currency: t.currency,
    faceValue: t.face_value,
    faceValueFormatted: `${c?.symbol ?? ""}${t.face_value.toLocaleString("en-US")}`,
    rateFormatted: formatNairaMinor(t.rate_minor),
    payoutMinor: t.payout_minor.toString(),
    payoutFormatted: formatNairaMinor(t.payout_minor),
    status: t.status,
    rejectReason: t.reject_reason,
    hasCode: !!t.code_enc,
    photos: t.file_ids?.length ?? 0,
    note: t.note,
    createdAt: t.created_at.toISOString(),
    reviewedAt: t.reviewed_at ? t.reviewed_at.toISOString() : null,
  };
}

export interface SubmitTradeInput {
  userId: string;
  rateId: string;
  faceValue: number;
  code?: string;
  pin?: string;
  fileIds: string[];
  note?: string;
  idempotencyKey: string;
}

/** Submit a card for review. Idempotent; locks the rate and payout. */
export async function submitTrade(input: SubmitTradeInput): Promise<TradeView> {
  await ensureGiftCardSchema();

  const replay = await prisma.$queryRawUnsafe<TradeRow[]>(
    `SELECT ${TRADE_COLS} FROM gift_card_trades WHERE idempotency_key = $1 AND user_id = $2::uuid`,
    input.idempotencyKey, input.userId,
  );
  if (replay[0]) return tradeView(replay[0]);

  const code = input.code?.trim() || "";
  const pin = input.pin?.trim() || "";
  const fileIds = [...new Set(input.fileIds)];
  if (!code && fileIds.length === 0) {
    throw new ApiError(422, "Add a photo of the card or type its code.", "no_card_details");
  }
  if (fileIds.length > MAX_FILES_PER_TRADE) {
    throw new ApiError(422, `Attach at most ${MAX_FILES_PER_TRADE} photos.`, "too_many_files");
  }

  // Gift-card fraud is common; only verified users can trade.
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { kycTier: true } });
  if (!user || user.kycTier < 1) {
    throw new ApiError(403, "Verify your identity before selling gift cards.", "kyc_required");
  }

  const rates = await prisma.$queryRawUnsafe<(RateRow & { brand_name: string; brand_active: boolean })[]>(
    `SELECT r.id::text, r.brand_id::text, r.country, r.card_type, r.currency, r.rate_minor, r.min_value, r.max_value,
            r.active, r.updated_by, r.updated_at, b.name AS brand_name, b.active AS brand_active
       FROM gift_card_rates r JOIN gift_card_brands b ON b.id = r.brand_id WHERE r.id = $1::uuid`,
    input.rateId,
  );
  const rate = rates[0];
  if (!rate || !rate.active || !rate.brand_active) {
    throw new ApiError(404, "We aren't buying that card right now.", "rate_unavailable");
  }
  const face = Math.trunc(input.faceValue);
  if (!Number.isFinite(face) || face < rate.min_value || face > rate.max_value) {
    const sym = CARD_COUNTRIES[rate.country]?.symbol ?? "";
    throw new ApiError(422, `Card value must be between ${sym}${rate.min_value} and ${sym}${rate.max_value}.`, "bad_value");
  }

  const [{ n: today }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM gift_card_trades WHERE user_id = $1::uuid AND created_at > now() - interval '24 hours'`,
    input.userId,
  );
  if (Number(today) >= DAILY_TRADE_LIMIT) {
    throw new ApiError(429, `You can submit up to ${DAILY_TRADE_LIMIT} cards a day. Try again tomorrow.`, "daily_limit");
  }

  // Photos must be the caller's own, and not already attached to a trade.
  if (fileIds.length) {
    const owned = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text FROM gift_card_files WHERE id = ANY($1::uuid[]) AND user_id = $2::uuid AND trade_id IS NULL`,
      fileIds, input.userId,
    );
    if (owned.length !== fileIds.length) {
      throw new ApiError(422, "One of those photos can't be used. Upload it again.", "bad_files");
    }
  }

  const payout = payoutMinor(face, rate.rate_minor);
  const rows = await prisma.$transaction(async (db) => {
    const created = await db.$queryRawUnsafe<TradeRow[]>(
      `INSERT INTO gift_card_trades
         (user_id, brand_id, brand_name, country, card_type, currency, face_value, rate_minor, payout_minor,
          code_enc, pin_enc, file_ids, note, idempotency_key)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid[], $13, $14)
       RETURNING ${TRADE_COLS}`,
      input.userId, rate.brand_id, rate.brand_name, rate.country, rate.card_type, rate.currency, face,
      rate.rate_minor, payout, code ? encryptPii(code) : null, pin ? encryptPii(pin) : null, fileIds,
      input.note?.trim().slice(0, 500) || null, input.idempotencyKey,
    );
    if (fileIds.length) {
      await db.$executeRawUnsafe(
        `UPDATE gift_card_files SET trade_id = $1::uuid WHERE id = ANY($2::uuid[])`, created[0].id, fileIds,
      );
    }
    await db.auditLog.create({
      data: {
        userId: input.userId,
        action: "giftcard.trade.submitted",
        resourceType: "GiftCardTrade",
        resourceId: created[0].id,
        details: { brand: rate.brand_name, country: rate.country, cardType: rate.card_type, faceValue: face, payoutMinor: payout.toString() },
      },
    });
    return created;
  });
  const trade = tradeView(rows[0]);

  await notifyUser(input.userId, {
    category: "deposits",
    emailKind: "money_in",
    title: "Gift card received",
    body: `We're checking your ${trade.faceValueFormatted} ${trade.brandName} card. You'll get ${trade.payoutFormatted} once it's approved.`,
    amount: trade.payoutFormatted,
    data: { giftCardTradeId: trade.id, url: "/gift-cards/trades/" },
    details: [
      { label: "Card", value: `${trade.brandName} · ${trade.countryName} · ${trade.cardType === "ECODE" ? "E-code" : "Physical"}` },
      { label: "Value", value: trade.faceValueFormatted },
      { label: "You'll get", value: trade.payoutFormatted },
    ],
  }).catch(() => undefined);
  void alertAdminsNewGiftCard(input.userId, trade).catch(() => undefined);
  return trade;
}

/**
 * Tell the review team a card is waiting (push to each admin's own CheqPay
 * app/browser, email, ops webhook). Best effort — never throws, never delays the user.
 */
export async function alertAdminsNewGiftCard(userId: string, trade: TradeView): Promise<void> {
  const [sender] = await prisma.$queryRawUnsafe<{ email: string | null; legal_name: string | null }[]>(
    `SELECT email, legal_name FROM app_users WHERE id = $1::uuid`, userId,
  ).catch(() => []);
  const who = sender?.legal_name || sender?.email || "A user";
  const card = `${trade.brandName} (${trade.countryName}, ${trade.cardType === "ECODE" ? "E-code" : "Physical"})`;
  const title = "New gift card to review";
  await notifyAdmins({
    title,
    body: `${who} sent a ${trade.faceValueFormatted} ${card} · pays ${trade.payoutFormatted}`,
    rows: [["From", who], ["Card", card], ["Value", trade.faceValueFormatted], ["Pays", trade.payoutFormatted]],
    where: "Gift cards",
    emailSubject: `${title}: ${trade.faceValueFormatted} ${trade.brandName}`,
    data: { giftCardTradeId: trade.id, kind: "admin_giftcard_review" },
    icon: "🎁",
  });
}

export async function listUserTrades(userId: string): Promise<TradeView[]> {
  await ensureGiftCardSchema();
  const rows = await prisma.$queryRawUnsafe<TradeRow[]>(
    `SELECT ${TRADE_COLS} FROM gift_card_trades WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 100`, userId,
  );
  return rows.map(tradeView);
}

// ---------------------------------------------------------------------------
// Admin review

export interface AdminTradeView extends TradeView {
  userId: string;
  userEmail: string | null;
  userName: string | null;
  kycTier: number;
  priorApproved: number;
  priorRejected: number;
  claimedBy: string | null;
  reviewedBy: string | null;
}
export interface AdminTradeDetail extends AdminTradeView {
  code: string | null;
  pin: string | null;
  photoUrls: string[];
}

type AdminRow = TradeRow & { email: string | null; legal_name: string | null; kyc_tier: number; approved: bigint; rejected: bigint };

function adminView(r: AdminRow): AdminTradeView {
  return {
    ...tradeView(r),
    userId: r.user_id,
    userEmail: r.email,
    userName: r.legal_name,
    kycTier: r.kyc_tier,
    priorApproved: Number(r.approved),
    priorRejected: Number(r.rejected),
    claimedBy: r.claimed_by,
    reviewedBy: r.reviewed_by,
  };
}

const ADMIN_SELECT = `SELECT t.${TRADE_COLS.split(",").map((c) => c.trim()).join(", t.")}, u.email, u.legal_name, u.kyc_tier,
    (SELECT count(*) FROM gift_card_trades p WHERE p.user_id = t.user_id AND p.status = 'APPROVED') AS approved,
    (SELECT count(*) FROM gift_card_trades p WHERE p.user_id = t.user_id AND p.status = 'REJECTED') AS rejected
  FROM gift_card_trades t JOIN app_users u ON u.id = t.user_id`;

export async function listTradesAdmin(status?: TradeStatus | "OPEN"): Promise<{ trades: AdminTradeView[]; open: number }> {
  await ensureGiftCardSchema();
  const where =
    status === "OPEN" ? `WHERE t.status IN ('SUBMITTED', 'IN_REVIEW')` : status ? `WHERE t.status = $1` : "";
  const order = status === "OPEN" ? "ORDER BY t.created_at ASC" : "ORDER BY t.created_at DESC";
  const rows = await prisma.$queryRawUnsafe<AdminRow[]>(
    `${ADMIN_SELECT} ${where} ${order} LIMIT 200`,
    ...(status && status !== "OPEN" ? [status] : []),
  );
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM gift_card_trades WHERE status IN ('SUBMITTED', 'IN_REVIEW')`,
  );
  return { trades: rows.map(adminView), open: Number(n) };
}

export async function getTradeAdmin(id: string, origin: string): Promise<AdminTradeDetail> {
  await ensureGiftCardSchema();
  const rows = await prisma.$queryRawUnsafe<AdminRow[]>(`${ADMIN_SELECT} WHERE t.id = $1::uuid`, id);
  const r = rows[0];
  if (!r) throw new ApiError(404, "Trade not found", "not_found");
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      return decryptPii(v);
    } catch {
      return "(can't decrypt)";
    }
  };
  return {
    ...adminView(r),
    code: dec(r.code_enc),
    pin: dec(r.pin_enc),
    photoUrls: (r.file_ids ?? []).map((f) => signGiftCardFileUrl(f, 15 * 60, origin)),
  };
}

/** Mark a trade as being reviewed, so two admins don't work the same card. */
export async function claimTrade(id: string, admin: string): Promise<void> {
  await ensureGiftCardSchema();
  const n = await prisma.$executeRawUnsafe(
    `UPDATE gift_card_trades SET status = 'IN_REVIEW', claimed_by = $2, claimed_at = now(), updated_at = now()
      WHERE id = $1::uuid AND status = 'SUBMITTED'`,
    id, admin,
  );
  if (!n) {
    const cur = await prisma.$queryRawUnsafe<{ status: string; claimed_by: string | null }[]>(
      `SELECT status, claimed_by FROM gift_card_trades WHERE id = $1::uuid`, id,
    );
    if (!cur[0]) throw new ApiError(404, "Trade not found", "not_found");
    if (cur[0].status !== "IN_REVIEW") throw new ApiError(409, `This trade is already ${cur[0].status.toLowerCase()}.`, "already_reviewed");
  }
}

/**
 * Approve: pay the locked payout into the user's NGN balance. Runs once — the
 * guarded status flip, the credit and the ledger row commit together.
 */
export async function approveTrade(id: string, admin: string): Promise<TradeView> {
  await ensureGiftCardSchema();
  await ensureGiftCardTxnTypes();
  const trade = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRawUnsafe<TradeRow[]>(
      `UPDATE gift_card_trades SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now(), updated_at = now()
        WHERE id = $1::uuid AND status IN ('SUBMITTED', 'IN_REVIEW') RETURNING ${TRADE_COLS}`,
      id, admin,
    );
    const t = rows[0];
    if (!t) throw new ApiError(409, "This trade has already been reviewed.", "already_reviewed");

    await db.balance.upsert({
      where: { userId_asset: { userId: t.user_id, asset: Asset.NGN } },
      update: { available: { increment: t.payout_minor } },
      create: { userId: t.user_id, asset: Asset.NGN, available: t.payout_minor },
    });
    const tx = await db.transaction.create({
      data: {
        userId: t.user_id,
        type: TransactionType.GIFTCARD_SELL,
        asset: Asset.NGN,
        amount: t.payout_minor,
        status: TransactionStatus.COMPLETED,
        // One ledger row per trade, ever.
        idempotencyKey: `giftcard-sell:${t.id}`,
        metadata: {
          kind: "giftcard_sell",
          tradeId: t.id,
          brand: t.brand_name,
          country: t.country,
          cardType: t.card_type,
          faceValue: t.face_value,
          currency: t.currency,
        },
      },
    });
    await db.$executeRawUnsafe(`UPDATE gift_card_trades SET transaction_id = $2::uuid WHERE id = $1::uuid`, t.id, tx.id);
    return t;
  });
  const view = tradeView(trade);
  await notifyUser(trade.user_id, {
    category: "deposits",
    emailKind: "money_in",
    title: "Gift card approved",
    body: `${view.payoutFormatted} for your ${view.faceValueFormatted} ${view.brandName} card is in your balance.`,
    amount: view.payoutFormatted,
    data: { giftCardTradeId: view.id, url: "/gift-cards/trades/" },
    details: [
      { label: "Card", value: `${view.brandName} · ${view.faceValueFormatted}` },
      { label: "Paid", value: view.payoutFormatted },
    ],
  }).catch(() => undefined);
  return view;
}

/** Reject with a reason the user sees. Never moves money. */
export async function rejectTrade(id: string, admin: string, reason: string): Promise<TradeView> {
  await ensureGiftCardSchema();
  const why = reason.trim().slice(0, 300);
  if (!why) throw new ApiError(422, "Give the user a reason.", "reason_required");
  const rows = await prisma.$queryRawUnsafe<TradeRow[]>(
    `UPDATE gift_card_trades SET status = 'REJECTED', reject_reason = $3, reviewed_by = $2, reviewed_at = now(), updated_at = now()
      WHERE id = $1::uuid AND status IN ('SUBMITTED', 'IN_REVIEW') RETURNING ${TRADE_COLS}`,
    id, admin, why,
  );
  const t = rows[0];
  if (!t) throw new ApiError(409, "This trade has already been reviewed.", "already_reviewed");
  const view = tradeView(t);
  await notifyUser(t.user_id, {
    category: "deposits",
    title: "Gift card not accepted",
    body: `Your ${view.faceValueFormatted} ${view.brandName} card wasn't accepted: ${why}`,
    data: { giftCardTradeId: view.id, url: "/gift-cards/trades/" },
  }).catch(() => undefined);
  return view;
}
