// apps/api/src/lib/referrals.ts
//
// Referrals and the influencer program.
//
// Every user has a BASIC code and earns a flat ₦ bonus when someone they refer
// QUALIFIES (verified identity + a first real transaction). Influencers —
// approved by an admin — have a custom code and earn a fixed share of the fee
// CheqPay makes on every transaction their referred users make, for a window
// set per influencer, plus rewards for tasks.
//
// Nothing is paid straight away. Every reward is first recorded as a HELD
// earning, keyed by what produced it (`commission:<txId>`, `basic:<userId>`,
// `task:<taskId>:<userId>` …) with a UNIQUE constraint, so running the
// settlement twice — the daily cron and an on-demand run racing — can never
// count anything twice. After the hold, each earning is paid once: a guarded
// HELD→PAID flip in the same transaction as the balance credit and the ledger
// row. An earning whose source goes away (refund, blocked account) is voided
// before it is paid.
//
// The tables are created lazily and are NOT Prisma models (see giftCards.ts).

import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { notifyUser } from "./alerts";
import { ensureGiftCardTxnTypes } from "./ensureGiftCardTxnTypes";
import { ApiError } from "./http";
import { decimalsFor, formatNairaMinor } from "./money";
import { getUsdtNgnRate } from "./settings";
import { cachedSetting, invalidateSetting } from "./settingsCache";

export const APPLY_WINDOW_DAYS = 7;
export const WEB_ORIGIN = "https://mycheqpay.com";
export const PORTAL_ORIGIN = "https://influencer.mycheqpay.com";

// ---------------------------------------------------------------------------
// Settings

export interface ReferralSettings {
  /** ₦ (kobo) paid to a basic referrer when their referral qualifies. */
  basicBonusMinor: number;
  welcomeEnabled: boolean;
  /** ₦ (kobo) paid to the new user when they qualify, if enabled. */
  welcomeBonusMinor: number;
  /** A qualifying first transaction must be at least this (kobo). */
  qualifyMinMinor: number;
  /** Defaults offered when approving an influencer. */
  defaultCommissionBps: number;
  defaultWindowDays: number | null;
  /** Hours an earning is held before it is paid. */
  holdHours: number;
  /** Most a single earner can be credited per calendar month (kobo). */
  monthlyCapMinor: number;
}

export const DEFAULT_SETTINGS: ReferralSettings = {
  basicBonusMinor: 50_000,
  welcomeEnabled: false,
  welcomeBonusMinor: 20_000,
  qualifyMinMinor: 500_000,
  defaultCommissionBps: 2_000,
  defaultWindowDays: 180,
  holdHours: 48,
  monthlyCapMinor: 50_000_000,
};

const SETTINGS_KEY = "referral_settings";

export async function getReferralSettings(): Promise<ReferralSettings> {
  return cachedSetting(SETTINGS_KEY, async () => {
    const row = await prisma.platformSetting.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<ReferralSettings>) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  });
}

export async function setReferralSettings(patch: Partial<ReferralSettings>, updatedBy: string): Promise<ReferralSettings> {
  const next = { ...(await getReferralSettings()), ...patch };
  await prisma.platformSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: JSON.stringify(next), updatedBy },
    create: { key: SETTINGS_KEY, value: JSON.stringify(next), updatedBy },
  });
  invalidateSetting(SETTINGS_KEY);
  return next;
}

// ---------------------------------------------------------------------------
// Schema

let ensured: Promise<void> | null = null;
export function ensureReferralSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const stmts = [
        `CREATE TABLE IF NOT EXISTS referral_codes (
          user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          code text NOT NULL,
          kind text NOT NULL DEFAULT 'BASIC' CHECK (kind IN ('BASIC', 'INFLUENCER')),
          commission_bps integer NOT NULL DEFAULT 0 CHECK (commission_bps >= 0 AND commission_bps <= 10000),
          window_days integer,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (lower(code))`,
        `CREATE TABLE IF NOT EXISTS referrals (
          referred_user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          referrer_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          code text NOT NULL,
          status text NOT NULL DEFAULT 'SIGNED_UP' CHECK (status IN ('SIGNED_UP', 'QUALIFIED')),
          created_at timestamptz NOT NULL DEFAULT now(),
          qualified_at timestamptz
        )`,
        `CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id, created_at)`,
        `CREATE TABLE IF NOT EXISTS referral_earnings (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          earner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK (kind IN ('COMMISSION', 'BASIC_BONUS', 'WELCOME_BONUS', 'TASK')),
          source_key text NOT NULL UNIQUE,
          referred_user_id uuid,
          source_txn_id uuid,
          amount_minor bigint NOT NULL CHECK (amount_minor > 0),
          status text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'PAID', 'VOID')),
          note text,
          release_at timestamptz NOT NULL,
          paid_at timestamptz,
          void_reason text,
          transaction_id uuid,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS referral_earnings_earner_idx ON referral_earnings (earner_user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS referral_earnings_release_idx ON referral_earnings (status, release_at)`,
        `CREATE TABLE IF NOT EXISTS influencer_tasks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL,
          description text NOT NULL DEFAULT '',
          kind text NOT NULL CHECK (kind IN ('AUTO', 'PROOF')),
          metric text CHECK (metric IN ('signups', 'qualified', 'volume_ngn', 'first_deposits')),
          target bigint,
          reward_minor bigint NOT NULL CHECK (reward_minor > 0),
          starts_at timestamptz NOT NULL DEFAULT now(),
          ends_at timestamptz,
          assigned uuid[] NOT NULL DEFAULT '{}',
          active boolean NOT NULL DEFAULT true,
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS task_submissions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id uuid NOT NULL REFERENCES influencer_tasks(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          proof_url text,
          note text,
          status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
          reason text,
          reviewed_by text,
          reviewed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (task_id, user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS influencer_applications (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
          full_name text NOT NULL,
          phone text NOT NULL,
          socials jsonb NOT NULL DEFAULT '[]',
          niche text NOT NULL DEFAULT '',
          location text NOT NULL DEFAULT '',
          why text NOT NULL DEFAULT '',
          preferred_code text,
          status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
          reason text,
          reviewed_by text,
          reviewed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS referral_clicks (
          code_lower text NOT NULL,
          day date NOT NULL,
          clicks integer NOT NULL DEFAULT 0,
          PRIMARY KEY (code_lower, day)
        )`,
      ];
      for (const s of stmts) await prisma.$executeRawUnsafe(s);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

// ---------------------------------------------------------------------------
// Codes

/** Upper-case letters and digits only, 4–16 long; null if it can't be a code. */
export function normalizeCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length >= 4 && c.length <= 16 ? c : null;
}

function randomSuffix(n: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

interface CodeRow {
  user_id: string;
  code: string;
  kind: "BASIC" | "INFLUENCER";
  commission_bps: number;
  window_days: number | null;
  active: boolean;
}

async function codeFor(userId: string): Promise<CodeRow | null> {
  const rows = await prisma.$queryRawUnsafe<CodeRow[]>(
    `SELECT user_id::text, code, kind, commission_bps, window_days, active FROM referral_codes WHERE user_id = $1::uuid`,
    userId,
  );
  return rows[0] ?? null;
}

async function codeTaken(code: string, exceptUser?: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM referral_codes WHERE lower(code) = lower($1) ${exceptUser ? "AND user_id <> $2::uuid" : ""}`,
    code,
    ...(exceptUser ? [exceptUser] : []),
  );
  return Number(rows[0].n) > 0;
}

/** The user's code, creating a basic one (from their username where possible) the first time. */
export async function ensureCode(userId: string): Promise<CodeRow> {
  await ensureReferralSchema();
  const existing = await codeFor(userId);
  if (existing) return existing;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  const base = (user?.username ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = base.length >= 3 && attempt === 0 ? base.padEnd(4, "0") : `${base.slice(0, 6) || "CQ"}${randomSuffix(attempt < 4 ? 3 : 5)}`;
    const code = normalizeCode(candidate);
    if (!code || (await codeTaken(code))) continue;
    const rows = await prisma.$queryRawUnsafe<CodeRow[]>(
      `INSERT INTO referral_codes (user_id, code) VALUES ($1::uuid, $2)
       ON CONFLICT DO NOTHING
       RETURNING user_id::text, code, kind, commission_bps, window_days, active`,
      userId,
      code,
    );
    if (rows[0]) return rows[0];
    const raced = await codeFor(userId);
    if (raced) return raced;
  }
  throw new ApiError(500, "Couldn't create your referral code. Try again.", "code_failed");
}

export function shareLink(row: Pick<CodeRow, "code" | "kind">): string {
  return row.kind === "INFLUENCER"
    ? `${PORTAL_ORIGIN}/r/${row.code}`
    : `${WEB_ORIGIN}/signup/?ref=${encodeURIComponent(row.code)}`;
}

// ---------------------------------------------------------------------------
// Attribution

/**
 * Attach the signed-in user to whoever owns `rawCode`. Allowed once, within a
 * week of opening the account, never for your own code or a blocked referrer,
 * and not when the two accounts have been used from the same IP address.
 */
export async function applyReferral(userId: string, rawCode: string): Promise<{ referrerName: string }> {
  await ensureReferralSchema();
  const code = normalizeCode(rawCode);
  if (!code) throw new ApiError(422, "That doesn't look like a referral code.", "bad_code");

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!me) throw new ApiError(404, "Account not found", "not_found");
  if (Date.now() - me.createdAt.getTime() > APPLY_WINDOW_DAYS * 86_400_000) {
    throw new ApiError(409, `Referral codes can only be added in your first ${APPLY_WINDOW_DAYS} days.`, "apply_window_closed");
  }
  const already = await prisma.$queryRawUnsafe<{ code: string }[]>(
    `SELECT code FROM referrals WHERE referred_user_id = $1::uuid`, userId,
  );
  if (already[0]) throw new ApiError(409, "You've already used a referral code.", "already_referred");

  const owners = await prisma.$queryRawUnsafe<(CodeRow & { status: string; username: string | null; legal_name: string | null })[]>(
    `SELECT c.user_id::text, c.code, c.kind, c.commission_bps, c.window_days, c.active, u.status::text AS status, u.username, u.legal_name
       FROM referral_codes c JOIN app_users u ON u.id = c.user_id WHERE lower(c.code) = lower($1)`,
    code,
  );
  const owner = owners[0];
  if (!owner || !owner.active || owner.status !== "ACTIVE") {
    throw new ApiError(404, "We couldn't find that referral code.", "code_not_found");
  }
  if (owner.user_id === userId) throw new ApiError(422, "You can't use your own code.", "own_code");

  // Same network as the referrer → almost always someone referring themselves.
  const shared = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM user_sessions a JOIN user_sessions b ON a.ip_address = b.ip_address
      WHERE a.user_id = $1::uuid AND b.user_id = $2::uuid AND a.ip_address <> ''`,
    userId,
    owner.user_id,
  );
  if (Number(shared[0].n) > 0) {
    throw new ApiError(422, "This code can't be used from the same device or network as its owner.", "same_network");
  }

  const inserted = await prisma.$executeRawUnsafe(
    `INSERT INTO referrals (referred_user_id, referrer_user_id, code) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING`,
    userId,
    owner.user_id,
    owner.code,
  );
  if (!inserted) throw new ApiError(409, "You've already used a referral code.", "already_referred");
  await prisma.auditLog.create({
    data: { userId, action: "referral.applied", resourceType: "Referral", resourceId: owner.user_id, details: { code: owner.code, kind: owner.kind } },
  });
  return { referrerName: owner.username ? `@${owner.username}` : (owner.legal_name?.split(" ")[0] ?? "a friend") };
}

/** Count one click on an influencer's tracking link. Unknown codes are ignored. */
export async function recordClick(rawCode: string): Promise<string | null> {
  await ensureReferralSchema();
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const rows = await prisma.$queryRawUnsafe<{ code: string }[]>(
    `SELECT code FROM referral_codes WHERE lower(code) = lower($1) AND active`, code,
  );
  if (!rows[0]) return null;
  await prisma.$executeRawUnsafe(
    `INSERT INTO referral_clicks (code_lower, day, clicks) VALUES (lower($1), current_date, 1)
     ON CONFLICT (code_lower, day) DO UPDATE SET clicks = referral_clicks.clicks + 1`,
    code,
  );
  return rows[0].code;
}

// ---------------------------------------------------------------------------
// Money helpers

/** ₦ kobo for an amount in `asset` minor units, or 0n for assets we don't price here. */
export function toNgnKobo(asset: string, minor: bigint, usdNgnRate: number | null): bigint {
  if (minor <= 0n) return 0n;
  if (asset === "NGN") return minor;
  if ((asset === "USD" || asset === "USDT" || asset === "USDC") && usdNgnRate && usdNgnRate > 0) {
    const dec = decimalsFor(asset as Asset);
    // minor / 10^dec dollars × rate ₦/$ × 100 kobo/₦
    return (minor * BigInt(Math.round(usdNgnRate * 100))) / 10n ** BigInt(dec);
  }
  return 0n;
}

/** CheqPay's revenue on a ledger row, in kobo: the recorded fee plus any recorded spread. */
export function revenueKobo(
  row: { asset: string; fee: bigint; spread_minor: string | null; spread_asset: string | null },
  rate: number | null,
): bigint {
  let total = toNgnKobo(row.asset, row.fee ?? 0n, rate);
  if (row.spread_minor && row.spread_asset && /^\d+$/.test(row.spread_minor)) {
    total += toNgnKobo(row.spread_asset, BigInt(row.spread_minor), rate);
  }
  return total;
}

export function commissionKobo(revenue: bigint, bps: number): bigint {
  return (revenue * BigInt(Math.trunc(bps))) / 10_000n;
}

async function monthToDate(earnerId: string): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<{ s: bigint | null }[]>(
    `SELECT sum(amount_minor)::bigint AS s FROM referral_earnings
      WHERE earner_user_id = $1::uuid AND status <> 'VOID' AND created_at >= date_trunc('month', now())`,
    earnerId,
  );
  return rows[0]?.s ?? 0n;
}

/** Record a held earning, clipped to the earner's monthly cap. Returns the amount recorded (0n if none). */
async function accrue(
  e: { earnerId: string; kind: string; sourceKey: string; amount: bigint; referredUserId?: string | null; sourceTxnId?: string | null; note?: string },
  s: ReferralSettings,
): Promise<bigint> {
  if (e.amount <= 0n) return 0n;
  const room = BigInt(s.monthlyCapMinor) - (await monthToDate(e.earnerId));
  const amount = e.amount > room ? room : e.amount;
  if (amount <= 0n) return 0n;
  const n = await prisma.$executeRawUnsafe(
    `INSERT INTO referral_earnings (earner_user_id, kind, source_key, referred_user_id, source_txn_id, amount_minor, note, release_at)
     VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6, $7, now() + make_interval(hours => $8::int))
     ON CONFLICT (source_key) DO NOTHING`,
    e.earnerId, e.kind, e.sourceKey, e.referredUserId ?? null, e.sourceTxnId ?? null, amount, e.note ?? null, s.holdHours,
  );
  return n ? amount : 0n;
}

// ---------------------------------------------------------------------------
// Settlement

export interface SettleResult { qualified: number; commissions: number; tasks: number; voided: number; paid: number }

/**
 * Work out and pay referral earnings. Safe to run any number of times, in
 * parallel: every earning is unique by its source, and payment is guarded.
 * With `earnerId`, only that person's referrals and earnings are touched (the
 * on-demand run when they open their dashboard).
 */
export async function settleReferrals(opts: { earnerId?: string } = {}): Promise<SettleResult> {
  await ensureReferralSchema();
  const s = await getReferralSettings();
  const rate = await getUsdtNgnRate();
  const res: SettleResult = { qualified: 0, commissions: 0, tasks: 0, voided: 0, paid: 0 };
  const earner = opts.earnerId ?? null;

  // 1. Qualify: verified identity + a first real transaction of at least the minimum.
  const rateKobo = BigInt(Math.round((rate ?? 0) * 100));
  const ready = await prisma.$queryRawUnsafe<{ referred_user_id: string; referrer_user_id: string; kind: string }[]>(
    `SELECT r.referred_user_id::text, r.referrer_user_id::text, c.kind
       FROM referrals r
       JOIN app_users u ON u.id = r.referred_user_id
       JOIN referral_codes c ON c.user_id = r.referrer_user_id
      WHERE r.status = 'SIGNED_UP' AND u.kyc_tier >= 1 AND u.status::text = 'ACTIVE'
        AND ($1::uuid IS NULL OR r.referrer_user_id = $1::uuid OR r.referred_user_id = $1::uuid)
        AND EXISTS (
          SELECT 1 FROM ledger_transactions t
           WHERE t.user_id = r.referred_user_id AND t.status::text = 'COMPLETED'
             AND t.type::text IN ('DEPOSIT', 'WITHDRAWAL', 'BILL', 'BUY', 'SELL', 'CONVERT', 'GADGET_PURCHASE', 'TICKET_PURCHASE', 'CARD_FUND')
             AND ((t.asset::text = 'NGN' AND t.amount >= $2) OR (t.asset::text = 'USD' AND t.amount * $3 >= $2))
        )
      LIMIT 1000`,
    earner, BigInt(s.qualifyMinMinor), rateKobo,
  );
  for (const r of ready) {
    const flipped = await prisma.$executeRawUnsafe(
      `UPDATE referrals SET status = 'QUALIFIED', qualified_at = now() WHERE referred_user_id = $1::uuid AND status = 'SIGNED_UP'`,
      r.referred_user_id,
    );
    if (!flipped) continue;
    res.qualified++;
    if (r.kind === "BASIC" && s.basicBonusMinor > 0) {
      await accrue({ earnerId: r.referrer_user_id, kind: "BASIC_BONUS", sourceKey: `basic:${r.referred_user_id}`, amount: BigInt(s.basicBonusMinor), referredUserId: r.referred_user_id, note: "Friend joined and qualified" }, s);
    }
    if (s.welcomeEnabled && s.welcomeBonusMinor > 0) {
      await accrue({ earnerId: r.referred_user_id, kind: "WELCOME_BONUS", sourceKey: `welcome:${r.referred_user_id}`, amount: BigInt(s.welcomeBonusMinor), referredUserId: r.referred_user_id, note: "Welcome bonus" }, s);
    }
  }

  // 2. Influencer commission: a share of the fee on each transaction their referrals make.
  const rows = await prisma.$queryRawUnsafe<{
    id: string; user_id: string; asset: string; fee: bigint; spread_minor: string | null; spread_asset: string | null;
    referrer_user_id: string; commission_bps: number; type: string;
  }[]>(
    `SELECT t.id::text, t.user_id::text, t.asset::text AS asset, t.fee, t.type::text AS type,
            t.metadata->>'spreadMinor' AS spread_minor, t.metadata->>'spreadAsset' AS spread_asset,
            r.referrer_user_id::text, c.commission_bps
       FROM ledger_transactions t
       JOIN referrals r ON r.referred_user_id = t.user_id
       JOIN referral_codes c ON c.user_id = r.referrer_user_id
      WHERE c.kind = 'INFLUENCER' AND c.active AND c.commission_bps > 0
        AND t.status::text = 'COMPLETED' AND t.created_at >= r.created_at
        AND (c.window_days IS NULL OR t.created_at < r.created_at + make_interval(days => c.window_days))
        AND (t.fee > 0 OR t.metadata ? 'spreadMinor')
        AND ($1::uuid IS NULL OR r.referrer_user_id = $1::uuid)
        AND NOT EXISTS (SELECT 1 FROM referral_earnings e WHERE e.source_key = 'commission:' || t.id::text)
      ORDER BY t.created_at
      LIMIT 2000`,
    earner,
  );
  for (const t of rows) {
    const amount = commissionKobo(revenueKobo(t, rate), t.commission_bps);
    const got = await accrue({ earnerId: t.referrer_user_id, kind: "COMMISSION", sourceKey: `commission:${t.id}`, amount, referredUserId: t.user_id, sourceTxnId: t.id, note: t.type }, s);
    if (got > 0n) res.commissions++;
  }

  // 3. Automatic tasks: pay once when an influencer's count reaches the target.
  const tasks = await prisma.$queryRawUnsafe<TaskRow[]>(
    `SELECT ${TASK_COLS} FROM influencer_tasks WHERE active AND kind = 'AUTO' AND starts_at <= now()
       AND (ends_at IS NULL OR ends_at > now() - interval '2 days')`,
  );
  if (tasks.length) {
    const influencers = await prisma.$queryRawUnsafe<{ user_id: string }[]>(
      `SELECT user_id::text FROM referral_codes WHERE kind = 'INFLUENCER' AND active AND ($1::uuid IS NULL OR user_id = $1::uuid)`,
      earner,
    );
    for (const task of tasks) {
      for (const inf of influencers) {
        if (task.assigned.length && !task.assigned.includes(inf.user_id)) continue;
        const progress = await taskProgress(task, inf.user_id, rate);
        if (task.target !== null && progress >= BigInt(task.target)) {
          const got = await accrue({ earnerId: inf.user_id, kind: "TASK", sourceKey: `task:${task.id}:${inf.user_id}`, amount: BigInt(task.reward_minor), note: task.title }, s);
          if (got > 0n) res.tasks++;
        }
      }
    }
  }

  // 4. Void what lost its source before it was paid.
  res.voided = await prisma.$executeRawUnsafe(
    `UPDATE referral_earnings e SET status = 'VOID', void_reason = 'Source transaction no longer completed or account blocked'
      WHERE e.status = 'HELD' AND ($1::uuid IS NULL OR e.earner_user_id = $1::uuid)
        AND (
          EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.id = e.source_txn_id AND t.status::text <> 'COMPLETED')
          OR EXISTS (SELECT 1 FROM app_users u WHERE u.id = e.referred_user_id AND u.status::text <> 'ACTIVE')
          OR EXISTS (SELECT 1 FROM app_users u WHERE u.id = e.earner_user_id AND u.status::text <> 'ACTIVE')
        )`,
    earner,
  );

  // 5. Pay what has finished its hold.
  const due = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id::text FROM referral_earnings WHERE status = 'HELD' AND release_at <= now()
       AND ($1::uuid IS NULL OR earner_user_id = $1::uuid) ORDER BY release_at LIMIT 500`,
    earner,
  );
  for (const d of due) if (await payEarning(d.id)) res.paid++;
  return res;
}

/** Pay one held earning into the earner's NGN balance. Returns false if it wasn't payable (already paid/voided). */
export async function payEarning(id: string): Promise<boolean> {
  await ensureGiftCardTxnTypes();
  const paid = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRawUnsafe<{ id: string; earner_user_id: string; amount_minor: bigint; kind: string; note: string | null }[]>(
      `UPDATE referral_earnings SET status = 'PAID', paid_at = now()
        WHERE id = $1::uuid AND status = 'HELD' AND release_at <= now()
        RETURNING id::text, earner_user_id::text, amount_minor, kind, note`,
      id,
    );
    const e = rows[0];
    if (!e) return null;
    await db.balance.upsert({
      where: { userId_asset: { userId: e.earner_user_id, asset: Asset.NGN } },
      update: { available: { increment: e.amount_minor } },
      create: { userId: e.earner_user_id, asset: Asset.NGN, available: e.amount_minor },
    });
    const tx = await db.transaction.create({
      data: {
        userId: e.earner_user_id,
        type: TransactionType.REFERRAL_REWARD,
        asset: Asset.NGN,
        amount: e.amount_minor,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: `referral:${e.id}`,
        metadata: { kind: "referral_reward", earningId: e.id, rewardKind: e.kind, note: e.note },
      },
    });
    await db.$executeRawUnsafe(`UPDATE referral_earnings SET transaction_id = $2::uuid WHERE id = $1::uuid`, e.id, tx.id);
    return e;
  });
  if (!paid) return false;
  const label =
    paid.kind === "COMMISSION" ? "Influencer commission" : paid.kind === "TASK" ? `Task reward${paid.note ? `: ${paid.note}` : ""}` : paid.kind === "WELCOME_BONUS" ? "Welcome bonus" : "Referral bonus";
  await notifyUser(paid.earner_user_id, {
    category: "deposits",
    emailKind: "money_in",
    title: label,
    body: `${formatNairaMinor(paid.amount_minor)} has been added to your balance.`,
    amount: formatNairaMinor(paid.amount_minor),
    data: { url: "/refer/" },
  }).catch(() => undefined);
  return true;
}

// ---------------------------------------------------------------------------
// Tasks

interface TaskRow {
  id: string; title: string; description: string; kind: "AUTO" | "PROOF"; metric: string | null; target: bigint | null;
  reward_minor: bigint; starts_at: Date; ends_at: Date | null; assigned: string[]; active: boolean; created_at: Date;
}
const TASK_COLS = `id::text, title, description, kind, metric, target, reward_minor, starts_at, ends_at, assigned::text[] AS assigned, active, created_at`;

export const TASK_METRICS = {
  signups: "Sign-ups with your link",
  qualified: "Referrals who verify and transact",
  volume_ngn: "Transaction volume from your referrals (₦)",
  first_deposits: "Referrals who make a first deposit",
} as const;
export type TaskMetric = keyof typeof TASK_METRICS;

/** How far an influencer is on an automatic task (volume in kobo; others are counts). */
export async function taskProgress(task: Pick<TaskRow, "metric" | "starts_at" | "ends_at">, userId: string, rate: number | null): Promise<bigint> {
  // Raw queries take dates as strings (cast in SQL); an open-ended task runs to 'infinity'.
  const args = [userId, task.starts_at.toISOString(), task.ends_at ? task.ends_at.toISOString() : "infinity"] as const;
  switch (task.metric) {
    case "signups": {
      const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM referrals WHERE referrer_user_id = $1::uuid AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`, ...args);
      return r[0].n;
    }
    case "qualified": {
      const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM referrals WHERE referrer_user_id = $1::uuid AND qualified_at >= $2::timestamptz AND qualified_at < $3::timestamptz`, ...args);
      return r[0].n;
    }
    case "first_deposits": {
      const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM referrals r
          WHERE r.referrer_user_id = $1::uuid
            AND (SELECT min(t.created_at) FROM ledger_transactions t
                  WHERE t.user_id = r.referred_user_id AND t.type::text = 'DEPOSIT' AND t.status::text = 'COMPLETED') >= $2::timestamptz
            AND (SELECT min(t.created_at) FROM ledger_transactions t
                  WHERE t.user_id = r.referred_user_id AND t.type::text = 'DEPOSIT' AND t.status::text = 'COMPLETED') < $3::timestamptz`, ...args);
      return r[0].n;
    }
    case "volume_ngn": {
      const r = await prisma.$queryRawUnsafe<{ asset: string; s: bigint | null }[]>(
        `SELECT t.asset::text AS asset, sum(t.amount)::bigint AS s FROM ledger_transactions t JOIN referrals r ON r.referred_user_id = t.user_id
          WHERE r.referrer_user_id = $1::uuid AND t.status::text = 'COMPLETED' AND t.created_at >= $2::timestamptz AND t.created_at < $3::timestamptz
            AND t.created_at >= r.created_at
            AND t.type::text NOT IN ('CASHBACK', 'REFERRAL_REWARD', 'TRANSFER_IN')
          GROUP BY t.asset`, ...args);
      return r.reduce((sum, x) => sum + toNgnKobo(x.asset, x.s ?? 0n, rate), 0n);
    }
    default:
      return 0n;
  }
}

export interface TaskView {
  id: string; title: string; description: string; kind: "AUTO" | "PROOF"; metric: string | null; metricLabel: string | null;
  target: string | null; targetFormatted: string | null; rewardMinor: string; rewardFormatted: string;
  startsAt: string; endsAt: string | null; active: boolean; assigned: string[];
}
function taskView(t: TaskRow): TaskView {
  const isVol = t.metric === "volume_ngn";
  return {
    id: t.id, title: t.title, description: t.description, kind: t.kind, metric: t.metric,
    metricLabel: t.metric ? TASK_METRICS[t.metric as TaskMetric] ?? null : null,
    target: t.target?.toString() ?? null,
    targetFormatted: t.target === null ? null : isVol ? formatNairaMinor(t.target) : t.target.toString(),
    rewardMinor: t.reward_minor.toString(), rewardFormatted: formatNairaMinor(t.reward_minor),
    startsAt: t.starts_at.toISOString(), endsAt: t.ends_at?.toISOString() ?? null, active: t.active, assigned: t.assigned,
  };
}

// ---------------------------------------------------------------------------
// Views

export interface EarningView {
  id: string; kind: string; amountMinor: string; amountFormatted: string; status: "HELD" | "PAID" | "VOID";
  note: string | null; releaseAt: string; paidAt: string | null; voidReason: string | null; createdAt: string;
}
type EarningRow = { id: string; kind: string; amount_minor: bigint; status: EarningView["status"]; note: string | null; release_at: Date; paid_at: Date | null; void_reason: string | null; created_at: Date };
function earningView(e: EarningRow): EarningView {
  return {
    id: e.id, kind: e.kind, amountMinor: e.amount_minor.toString(), amountFormatted: formatNairaMinor(e.amount_minor), status: e.status,
    note: e.note, releaseAt: e.release_at.toISOString(), paidAt: e.paid_at?.toISOString() ?? null, voidReason: e.void_reason, createdAt: e.created_at.toISOString(),
  };
}

async function earningTotals(userId: string) {
  const rows = await prisma.$queryRawUnsafe<{ status: string; s: bigint | null; month: bigint | null }[]>(
    `SELECT status, sum(amount_minor)::bigint AS s, (sum(amount_minor) FILTER (WHERE created_at >= date_trunc('month', now())))::bigint AS month
       FROM referral_earnings WHERE earner_user_id = $1::uuid GROUP BY status`,
    userId,
  );
  const get = (st: string) => rows.find((r) => r.status === st);
  const held = get("HELD")?.s ?? 0n, paid = get("PAID")?.s ?? 0n;
  const month = (get("HELD")?.month ?? 0n) + (get("PAID")?.month ?? 0n);
  return {
    heldFormatted: formatNairaMinor(held), paidFormatted: formatNairaMinor(paid),
    lifetimeFormatted: formatNairaMinor(held + paid), thisMonthFormatted: formatNairaMinor(month),
    heldMinor: held.toString(), paidMinor: paid.toString(),
  };
}

async function referralCounts(userId: string) {
  const rows = await prisma.$queryRawUnsafe<{ status: string; n: bigint }[]>(
    `SELECT status, count(*) AS n FROM referrals WHERE referrer_user_id = $1::uuid GROUP BY status`, userId,
  );
  const q = Number(rows.find((r) => r.status === "QUALIFIED")?.n ?? 0);
  const su = Number(rows.find((r) => r.status === "SIGNED_UP")?.n ?? 0);
  return { signedUp: q + su, qualified: q };
}

async function applicationStatus(userId: string): Promise<{ status: string; reason: string | null } | null> {
  const rows = await prisma.$queryRawUnsafe<{ status: string; reason: string | null }[]>(
    `SELECT status, reason FROM influencer_applications WHERE user_id = $1::uuid`, userId,
  );
  return rows[0] ?? null;
}

/** Everything the in-app "Refer & earn" page shows. Settles the user's own earnings first. */
export async function getMyReferral(userId: string) {
  await ensureReferralSchema();
  await settleReferrals({ earnerId: userId }).catch((err) => console.error("[referrals] on-demand settle", err));
  const code = await ensureCode(userId);
  const s = await getReferralSettings();
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  const referredBy = await prisma.$queryRawUnsafe<{ code: string }[]>(`SELECT code FROM referrals WHERE referred_user_id = $1::uuid`, userId);
  const earnings = await prisma.$queryRawUnsafe<EarningRow[]>(
    `SELECT id::text, kind, amount_minor, status, note, release_at, paid_at, void_reason, created_at
       FROM referral_earnings WHERE earner_user_id = $1::uuid ORDER BY created_at DESC LIMIT 50`, userId,
  );
  const canApply = !referredBy[0] && !!me && Date.now() - me.createdAt.getTime() <= APPLY_WINDOW_DAYS * 86_400_000;
  return {
    code: code.code,
    kind: code.kind,
    link: shareLink(code),
    active: code.active,
    basicBonusFormatted: formatNairaMinor(BigInt(s.basicBonusMinor)),
    welcomeBonusFormatted: s.welcomeEnabled ? formatNairaMinor(BigInt(s.welcomeBonusMinor)) : null,
    qualifyMinFormatted: formatNairaMinor(BigInt(s.qualifyMinMinor)),
    holdHours: s.holdHours,
    counts: await referralCounts(userId),
    totals: await earningTotals(userId),
    earnings: earnings.map(earningView),
    referredBy: referredBy[0]?.code ?? null,
    canApply,
    application: await applicationStatus(userId),
    portalUrl: PORTAL_ORIGIN,
  };
}

// ---------------------------------------------------------------------------
// Influencer portal

export interface Social { platform: string; handle: string; followers: number }
export interface ApplicationInput {
  fullName: string; phone: string; socials: Social[]; niche: string; location: string; why: string; preferredCode?: string;
}

export async function getApplication(userId: string) {
  await ensureReferralSchema();
  const rows = await prisma.$queryRawUnsafe<{ id: string; full_name: string; phone: string; socials: Social[]; niche: string; location: string; why: string; preferred_code: string | null; status: string; reason: string | null; created_at: Date }[]>(
    `SELECT id::text, full_name, phone, socials, niche, location, why, preferred_code, status, reason, created_at FROM influencer_applications WHERE user_id = $1::uuid`, userId,
  );
  const code = await codeFor(userId);
  const a = rows[0];
  return {
    isInfluencer: code?.kind === "INFLUENCER" && code.active,
    application: a
      ? { id: a.id, fullName: a.full_name, phone: a.phone, socials: a.socials, niche: a.niche, location: a.location, why: a.why, preferredCode: a.preferred_code, status: a.status, reason: a.reason, createdAt: a.created_at.toISOString() }
      : null,
  };
}

/** Apply (or re-apply after a rejection) to the influencer program. */
export async function submitApplication(userId: string, input: ApplicationInput): Promise<void> {
  await ensureReferralSchema();
  const code = await codeFor(userId);
  if (code?.kind === "INFLUENCER") throw new ApiError(409, "You're already in the influencer program.", "already_influencer");
  const preferred = input.preferredCode ? normalizeCode(input.preferredCode) : null;
  if (input.preferredCode && !preferred) throw new ApiError(422, "Codes are 4–16 letters or numbers.", "bad_code");
  const socials = input.socials.filter((x) => x.handle.trim()).slice(0, 8);
  if (!socials.length) throw new ApiError(422, "Add at least one social account.", "no_socials");
  const n = await prisma.$executeRawUnsafe(
    `INSERT INTO influencer_applications (user_id, full_name, phone, socials, niche, location, why, preferred_code)
     VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, socials = EXCLUDED.socials,
       niche = EXCLUDED.niche, location = EXCLUDED.location, why = EXCLUDED.why, preferred_code = EXCLUDED.preferred_code,
       status = 'PENDING', reason = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
     WHERE influencer_applications.status <> 'PENDING'`,
    userId, input.fullName.trim().slice(0, 120), input.phone.trim().slice(0, 40), JSON.stringify(socials),
    input.niche.trim().slice(0, 120), input.location.trim().slice(0, 120), input.why.trim().slice(0, 1000), preferred,
  );
  if (!n) throw new ApiError(409, "Your application is already being reviewed.", "already_applied");
}

async function requireInfluencer(userId: string): Promise<CodeRow> {
  await ensureReferralSchema();
  const code = await codeFor(userId);
  if (!code || code.kind !== "INFLUENCER") throw new ApiError(403, "This is for approved influencers.", "not_influencer");
  return code;
}

/** The portal dashboard: headline numbers and a 30-day series. */
export async function influencerDashboard(userId: string) {
  const code = await requireInfluencer(userId);
  await settleReferrals({ earnerId: userId }).catch((err) => console.error("[referrals] on-demand settle", err));
  const rate = await getUsdtNgnRate();
  const [clicks] = await prisma.$queryRawUnsafe<{ n: bigint | null }[]>(
    `SELECT sum(clicks)::bigint AS n FROM referral_clicks WHERE code_lower = lower($1)`, code.code,
  );
  const volume = await taskProgress({ metric: "volume_ngn", starts_at: new Date(0), ends_at: null }, userId, rate);
  const series = await prisma.$queryRawUnsafe<{ day: Date; clicks: number; signups: bigint; earned: bigint }[]>(
    `WITH days AS (SELECT generate_series(current_date - 29, current_date, interval '1 day')::date AS day)
     SELECT d.day,
            COALESCE((SELECT clicks FROM referral_clicks c WHERE c.code_lower = lower($2) AND c.day = d.day), 0) AS clicks,
            (SELECT count(*) FROM referrals r WHERE r.referrer_user_id = $1::uuid AND r.created_at::date = d.day) AS signups,
            COALESCE((SELECT sum(amount_minor)::bigint FROM referral_earnings e WHERE e.earner_user_id = $1::uuid AND e.status <> 'VOID' AND e.created_at::date = d.day), 0) AS earned
       FROM days d ORDER BY d.day`,
    userId, code.code,
  );
  return {
    code: code.code,
    link: shareLink(code),
    active: code.active,
    commissionPercent: code.commission_bps / 100,
    windowDays: code.window_days,
    clicks: Number(clicks?.n ?? 0),
    counts: await referralCounts(userId),
    volumeFormatted: formatNairaMinor(volume),
    totals: await earningTotals(userId),
    series: series.map((d) => ({ day: d.day.toISOString().slice(0, 10), clicks: Number(d.clicks), signups: Number(d.signups), earnedMinor: d.earned.toString() })),
  };
}

export async function influencerEarnings(userId: string): Promise<EarningView[]> {
  await requireInfluencer(userId);
  const rows = await prisma.$queryRawUnsafe<EarningRow[]>(
    `SELECT id::text, kind, amount_minor, status, note, release_at, paid_at, void_reason, created_at
       FROM referral_earnings WHERE earner_user_id = $1::uuid ORDER BY created_at DESC LIMIT 500`, userId,
  );
  return rows.map(earningView);
}

export async function influencerTasks(userId: string) {
  await requireInfluencer(userId);
  const rate = await getUsdtNgnRate();
  const tasks = await prisma.$queryRawUnsafe<TaskRow[]>(
    `SELECT ${TASK_COLS} FROM influencer_tasks WHERE active AND (cardinality(assigned) = 0 OR $1::uuid = ANY(assigned))
       ORDER BY (ends_at IS NULL), ends_at, created_at DESC`, userId,
  );
  const subs = await prisma.$queryRawUnsafe<{ task_id: string; status: string; reason: string | null; proof_url: string | null }[]>(
    `SELECT task_id::text, status, reason, proof_url FROM task_submissions WHERE user_id = $1::uuid`, userId,
  );
  const rewarded = await prisma.$queryRawUnsafe<{ source_key: string; status: string }[]>(
    `SELECT source_key, status FROM referral_earnings WHERE earner_user_id = $1::uuid AND kind = 'TASK'`, userId,
  );
  const out = [];
  for (const t of tasks) {
    const progress = t.kind === "AUTO" ? await taskProgress(t, userId, rate) : null;
    const done = rewarded.find((r) => r.source_key === `task:${t.id}:${userId}`);
    out.push({
      ...taskView(t),
      progress: progress?.toString() ?? null,
      progressFormatted: progress === null ? null : t.metric === "volume_ngn" ? formatNairaMinor(progress) : progress.toString(),
      submission: subs.find((s) => s.task_id === t.id) ?? null,
      rewarded: done ? done.status : null,
      expired: !!t.ends_at && t.ends_at.getTime() < Date.now(),
    });
  }
  return out;
}

export async function submitTaskProof(userId: string, taskId: string, proofUrl: string, note: string): Promise<void> {
  await requireInfluencer(userId);
  const rows = await prisma.$queryRawUnsafe<TaskRow[]>(`SELECT ${TASK_COLS} FROM influencer_tasks WHERE id = $1::uuid`, taskId);
  const t = rows[0];
  if (!t || !t.active || t.kind !== "PROOF") throw new ApiError(404, "Task not found", "not_found");
  if (t.assigned.length && !t.assigned.includes(userId)) throw new ApiError(404, "Task not found", "not_found");
  if (t.ends_at && t.ends_at.getTime() < Date.now()) throw new ApiError(409, "This task has ended.", "task_ended");
  const n = await prisma.$executeRawUnsafe(
    `INSERT INTO task_submissions (task_id, user_id, proof_url, note) VALUES ($1::uuid, $2::uuid, $3, $4)
     ON CONFLICT (task_id, user_id) DO UPDATE SET proof_url = EXCLUDED.proof_url, note = EXCLUDED.note, status = 'PENDING',
       reason = NULL, reviewed_by = NULL, reviewed_at = NULL, created_at = now()
     WHERE task_submissions.status = 'REJECTED'`,
    taskId, userId, proofUrl.trim().slice(0, 500), note.trim().slice(0, 1000),
  );
  if (!n) throw new ApiError(409, "You've already submitted this task.", "already_submitted");
}

// ---------------------------------------------------------------------------
// Admin

async function findUser(ref: string): Promise<{ id: string; email: string }> {
  const r = ref.trim().replace(/^@/, "");
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: { equals: r, mode: "insensitive" } }, { username: { equals: r, mode: "insensitive" } }] },
    select: { id: true, email: true },
  });
  if (!user) throw new ApiError(404, "No user with that email or username.", "user_not_found");
  return user;
}

export async function listInfluencersAdmin() {
  await ensureReferralSchema();
  const rows = await prisma.$queryRawUnsafe<{
    user_id: string; code: string; commission_bps: number; window_days: number | null; active: boolean; email: string; username: string | null;
    signups: bigint; qualified: bigint; earned: bigint | null; clicks: bigint | null; created_at: Date;
  }[]>(
    `SELECT c.user_id::text, c.code, c.commission_bps, c.window_days, c.active, u.email, u.username, c.created_at,
            (SELECT count(*) FROM referrals r WHERE r.referrer_user_id = c.user_id) AS signups,
            (SELECT count(*) FROM referrals r WHERE r.referrer_user_id = c.user_id AND r.status = 'QUALIFIED') AS qualified,
            (SELECT sum(amount_minor)::bigint FROM referral_earnings e WHERE e.earner_user_id = c.user_id AND e.status <> 'VOID') AS earned,
            (SELECT sum(clicks)::bigint FROM referral_clicks k WHERE k.code_lower = lower(c.code)) AS clicks
       FROM referral_codes c JOIN app_users u ON u.id = c.user_id WHERE c.kind = 'INFLUENCER' ORDER BY c.created_at DESC`,
  );
  return rows.map((r) => ({
    userId: r.user_id, code: r.code, commissionPercent: r.commission_bps / 100, windowDays: r.window_days, active: r.active,
    email: r.email, username: r.username, signups: Number(r.signups), qualified: Number(r.qualified),
    clicks: Number(r.clicks ?? 0), earnedFormatted: formatNairaMinor(r.earned ?? 0n), createdAt: r.created_at.toISOString(),
    link: `${PORTAL_ORIGIN}/r/${r.code}`,
  }));
}

/** Make (or update) someone an influencer with their own code, % and window. */
export async function upsertInfluencer(input: { user: string; code: string; commissionPercent: number; windowDays: number | null; active: boolean }): Promise<string> {
  await ensureReferralSchema();
  const user = await findUser(input.user);
  const code = normalizeCode(input.code);
  if (!code) throw new ApiError(422, "Codes are 4–16 letters or numbers.", "bad_code");
  if (await codeTaken(code, user.id)) throw new ApiError(409, "That code is taken.", "code_taken");
  const bps = Math.round(input.commissionPercent * 100);
  if (bps < 0 || bps > 10_000) throw new ApiError(422, "Commission must be 0–100%.", "bad_commission");
  await prisma.$executeRawUnsafe(
    `INSERT INTO referral_codes (user_id, code, kind, commission_bps, window_days, active)
     VALUES ($1::uuid, $2, 'INFLUENCER', $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, kind = 'INFLUENCER', commission_bps = EXCLUDED.commission_bps,
       window_days = EXCLUDED.window_days, active = EXCLUDED.active, updated_at = now()`,
    user.id, code, bps, input.windowDays, input.active,
  );
  return user.id;
}

export async function listApplicationsAdmin(status = "PENDING") {
  await ensureReferralSchema();
  const rows = await prisma.$queryRawUnsafe<{ id: string; user_id: string; email: string; kyc_tier: number; full_name: string; phone: string; socials: Social[]; niche: string; location: string; why: string; preferred_code: string | null; status: string; reason: string | null; reviewed_by: string | null; created_at: Date }[]>(
    `SELECT a.id::text, a.user_id::text, u.email, u.kyc_tier, a.full_name, a.phone, a.socials, a.niche, a.location, a.why, a.preferred_code,
            a.status, a.reason, a.reviewed_by, a.created_at
       FROM influencer_applications a JOIN app_users u ON u.id = a.user_id
      WHERE ($1 = 'ALL' OR a.status = $1) ORDER BY a.created_at ${status === "PENDING" ? "ASC" : "DESC"} LIMIT 300`,
    status,
  );
  return rows.map((a) => ({
    id: a.id, userId: a.user_id, email: a.email, kycTier: a.kyc_tier, fullName: a.full_name, phone: a.phone, socials: a.socials,
    niche: a.niche, location: a.location, why: a.why, preferredCode: a.preferred_code, status: a.status, reason: a.reason,
    reviewedBy: a.reviewed_by, createdAt: a.created_at.toISOString(),
  }));
}

export async function decideApplication(
  id: string,
  admin: string,
  d: { approve: true; code: string; commissionPercent: number; windowDays: number | null } | { approve: false; reason: string },
): Promise<{ userId: string }> {
  await ensureReferralSchema();
  const rows = await prisma.$queryRawUnsafe<{ user_id: string; email: string }[]>(
    `SELECT a.user_id::text, u.email FROM influencer_applications a JOIN app_users u ON u.id = a.user_id WHERE a.id = $1::uuid AND a.status = 'PENDING'`, id,
  );
  const a = rows[0];
  if (!a) throw new ApiError(409, "This application has already been decided.", "already_decided");
  if (d.approve) {
    await upsertInfluencer({ user: a.email, code: d.code, commissionPercent: d.commissionPercent, windowDays: d.windowDays, active: true });
    await prisma.$executeRawUnsafe(
      `UPDATE influencer_applications SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now() WHERE id = $1::uuid`, id, admin,
    );
    await notifyUser(a.user_id, {
      category: "updates",
      title: "You're in! 🎉",
      body: `Welcome to the CheqPay influencer program. Your code is ${normalizeCode(d.code)} — open your dashboard at influencer.mycheqpay.com.`,
      data: { url: PORTAL_ORIGIN },
    }).catch(() => undefined);
  } else {
    const why = d.reason.trim().slice(0, 300);
    if (!why) throw new ApiError(422, "Give a reason.", "reason_required");
    await prisma.$executeRawUnsafe(
      `UPDATE influencer_applications SET status = 'REJECTED', reason = $3, reviewed_by = $2, reviewed_at = now() WHERE id = $1::uuid`, id, admin, why,
    );
    await notifyUser(a.user_id, {
      category: "updates",
      title: "About your influencer application",
      body: `We can't add you to the influencer program right now: ${why}`,
      data: { url: `${PORTAL_ORIGIN}/apply` },
    }).catch(() => undefined);
  }
  return { userId: a.user_id };
}

export async function listTasksAdmin() {
  await ensureReferralSchema();
  const tasks = await prisma.$queryRawUnsafe<(TaskRow & { done: bigint; pending: bigint })[]>(
    `SELECT x.*,
            (SELECT count(*) FROM referral_earnings e WHERE e.kind = 'TASK' AND e.source_key LIKE 'task:' || x.id || ':%' AND e.status <> 'VOID') AS done,
            (SELECT count(*) FROM task_submissions s WHERE s.task_id = x.id::uuid AND s.status = 'PENDING') AS pending
       FROM (SELECT ${TASK_COLS} FROM influencer_tasks) x ORDER BY x.created_at DESC`,
  );
  return tasks.map((t) => ({ ...taskView(t), completed: Number(t.done), pendingSubmissions: Number(t.pending) }));
}

export async function upsertTask(input: {
  id?: string; title: string; description: string; kind: "AUTO" | "PROOF"; metric: TaskMetric | null; target: bigint | null;
  rewardMinor: bigint; startsAt: Date; endsAt: Date | null; assigned: string[]; active: boolean;
}, admin: string): Promise<string> {
  await ensureReferralSchema();
  if (input.kind === "AUTO" && (!input.metric || input.target === null || input.target <= 0n)) {
    throw new ApiError(422, "An automatic task needs a measure and a target.", "bad_task");
  }
  if (input.rewardMinor <= 0n) throw new ApiError(422, "Set a reward.", "bad_task");
  const assigned: string[] = [];
  for (const ref of input.assigned) assigned.push((await findUser(ref)).id);
  if (input.id) {
    await prisma.$executeRawUnsafe(
      `UPDATE influencer_tasks SET title=$2, description=$3, kind=$4, metric=$5, target=$6, reward_minor=$7, starts_at=$8::timestamptz, ends_at=$9::timestamptz,
              assigned=$10::uuid[], active=$11 WHERE id=$1::uuid`,
      input.id, input.title, input.description, input.kind, input.kind === "AUTO" ? input.metric : null, input.kind === "AUTO" ? input.target : null,
      input.rewardMinor, input.startsAt.toISOString(), input.endsAt?.toISOString() ?? null, assigned, input.active,
    );
    return input.id;
  }
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO influencer_tasks (title, description, kind, metric, target, reward_minor, starts_at, ends_at, assigned, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::uuid[], $10, $11) RETURNING id::text`,
    input.title, input.description, input.kind, input.kind === "AUTO" ? input.metric : null, input.kind === "AUTO" ? input.target : null,
    input.rewardMinor, input.startsAt.toISOString(), input.endsAt?.toISOString() ?? null, assigned, input.active, admin,
  );
  return rows[0].id;
}

export async function listSubmissionsAdmin(status = "PENDING") {
  await ensureReferralSchema();
  const rows = await prisma.$queryRawUnsafe<{ id: string; task_id: string; title: string; reward_minor: bigint; user_id: string; email: string; code: string | null; proof_url: string | null; note: string | null; status: string; reason: string | null; created_at: Date }[]>(
    `SELECT s.id::text, s.task_id::text, t.title, t.reward_minor, s.user_id::text, u.email, c.code, s.proof_url, s.note, s.status, s.reason, s.created_at
       FROM task_submissions s JOIN influencer_tasks t ON t.id = s.task_id JOIN app_users u ON u.id = s.user_id
       LEFT JOIN referral_codes c ON c.user_id = s.user_id
      WHERE ($1 = 'ALL' OR s.status = $1) ORDER BY s.created_at ${status === "PENDING" ? "ASC" : "DESC"} LIMIT 300`,
    status,
  );
  return rows.map((r) => ({
    id: r.id, taskId: r.task_id, taskTitle: r.title, rewardFormatted: formatNairaMinor(r.reward_minor), userId: r.user_id,
    email: r.email, code: r.code, proofUrl: r.proof_url, note: r.note, status: r.status, reason: r.reason, createdAt: r.created_at.toISOString(),
  }));
}

/** Approve (creates the task reward, paid after the hold) or reject a proof submission. */
export async function decideSubmission(id: string, admin: string, approve: boolean, reason?: string): Promise<void> {
  await ensureReferralSchema();
  const rows = await prisma.$queryRawUnsafe<{ task_id: string; user_id: string; title: string; reward_minor: bigint }[]>(
    `UPDATE task_submissions s SET status = $3, reason = $4, reviewed_by = $2, reviewed_at = now()
       FROM influencer_tasks t WHERE s.id = $1::uuid AND s.status = 'PENDING' AND t.id = s.task_id
     RETURNING s.task_id::text, s.user_id::text, t.title, t.reward_minor`,
    id, admin, approve ? "APPROVED" : "REJECTED", approve ? null : (reason ?? "").trim().slice(0, 300) || "Not accepted",
  );
  const r = rows[0];
  if (!r) throw new ApiError(409, "This submission has already been reviewed.", "already_reviewed");
  if (approve) {
    await accrue({ earnerId: r.user_id, kind: "TASK", sourceKey: `task:${r.task_id}:${r.user_id}`, amount: r.reward_minor, note: r.title }, await getReferralSettings());
  }
  await notifyUser(r.user_id, {
    category: "updates",
    title: approve ? "Task approved" : "Task not approved",
    body: approve
      ? `"${r.title}" was approved — ${formatNairaMinor(r.reward_minor)} will be added to your balance.`
      : `"${r.title}" wasn't approved: ${(reason ?? "").trim() || "see your dashboard"}`,
    data: { url: `${PORTAL_ORIGIN}/tasks` },
  }).catch(() => undefined);
}

export async function earningsOverviewAdmin() {
  await ensureReferralSchema();
  const totals = await prisma.$queryRawUnsafe<{ status: string; kind: string; s: bigint; n: bigint }[]>(
    `SELECT status, kind, sum(amount_minor)::bigint AS s, count(*) AS n FROM referral_earnings GROUP BY status, kind`,
  );
  const top = await prisma.$queryRawUnsafe<{ user_id: string; email: string; code: string | null; s: bigint }[]>(
    `SELECT e.earner_user_id::text AS user_id, u.email, c.code, sum(e.amount_minor)::bigint AS s
       FROM referral_earnings e JOIN app_users u ON u.id = e.earner_user_id LEFT JOIN referral_codes c ON c.user_id = e.earner_user_id
      WHERE e.status <> 'VOID' GROUP BY 1, 2, 3 ORDER BY s DESC LIMIT 20`,
  );
  const recent = await prisma.$queryRawUnsafe<(EarningRow & { email: string })[]>(
    `SELECT e.id::text, e.kind, e.amount_minor, e.status, e.note, e.release_at, e.paid_at, e.void_reason, e.created_at, u.email
       FROM referral_earnings e JOIN app_users u ON u.id = e.earner_user_id ORDER BY e.created_at DESC LIMIT 100`,
  );
  const sum = (st: string) => totals.filter((t) => t.status === st).reduce((a, t) => a + t.s, 0n);
  return {
    heldFormatted: formatNairaMinor(sum("HELD")), paidFormatted: formatNairaMinor(sum("PAID")), voidFormatted: formatNairaMinor(sum("VOID")),
    byKind: totals.map((t) => ({ status: t.status, kind: t.kind, totalFormatted: formatNairaMinor(t.s), count: Number(t.n) })),
    top: top.map((t) => ({ userId: t.user_id, email: t.email, code: t.code, totalFormatted: formatNairaMinor(t.s) })),
    recent: recent.map((r) => ({ ...earningView(r), email: r.email })),
  };
}

export async function voidEarning(id: string, reason: string): Promise<void> {
  await ensureReferralSchema();
  const n = await prisma.$executeRawUnsafe(
    `UPDATE referral_earnings SET status = 'VOID', void_reason = $2 WHERE id = $1::uuid AND status = 'HELD'`, id, reason.trim().slice(0, 300) || "Voided by admin",
  );
  if (!n) throw new ApiError(409, "Only held earnings can be voided.", "not_held");
}
