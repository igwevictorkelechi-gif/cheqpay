// apps/api/src/lib/whatsapp/actions.ts
//
// A payment the bot COMPOSED, waiting to be confirmed on the website.
//
// Nothing here moves money, and nothing here is authority. A pending action is
// a *proposal*: it carries no PIN, no token and no session. Every field is
// re-validated server-side at approval against the signed-in user, and the row
// is refused outright if its user_id is not that user — so a leaked link is
// useless to anyone but its owner.
//
// Codes follow lib/sso.ts: 256 random bits, stored only as sha256, single use,
// short-lived.

import { randomBytes } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import { s256 } from "../sso";
import { formatNairaMinor } from "../money";
import { getWhatsappP2pDailyCapKobo, getWhatsappSelfDailyCapKobo } from "../settings";
import { ensureWhatsappSchema } from "./schema";

/** Long enough to switch apps and sign in; short enough that a stale link dies. */
export const ACTION_TTL_MINUTES = 15;

export const ACTION_CODE = /^[A-Za-z0-9_-]{43}$/;

export type ActionKind = "transfer" | "withdraw" | "bill";

/** Send naira to another CheqPay user. The only kind that can reach a stranger. */
export interface TransferPayload {
  kind: "transfer";
  username: string;
  amountMinor: string; // bigint as a string: JSON has no bigint
}

/** Pay out to one of the user's OWN saved bank accounts (name-matched at the route). */
export interface WithdrawPayload {
  kind: "withdraw";
  beneficiaryId: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  amountMinor: string;
}

/** Airtime, data, power — the user's own meter or phone. */
export interface BillPayload {
  kind: "bill";
  service: string;
  billerId: string;
  billerName: string;
  customer: string;
  planId?: string;
  amountMinor: string;
}

export type ActionPayload = TransferPayload | WithdrawPayload | BillPayload;

/**
 * Which daily ceiling an action counts against.
 *
 * "self" money can only reach the user's own bank account or their own meter,
 * so a stolen WhatsApp account gains nothing from it. "p2p" can reach anyone,
 * and is the only kind worth stealing — hence the split.
 */
export function capClassOf(kind: ActionKind): "p2p" | "self" {
  return kind === "transfer" ? "p2p" : "self";
}

export function amountOf(payload: ActionPayload): bigint {
  return BigInt(payload.amountMinor);
}

/**
 * The money route's Idempotency-Key for this action, derived from the code.
 *
 * Deterministic on purpose: it is what makes a double payment impossible
 * without the burn having to be reliable. A refresh, a double tap or a failed
 * burn all re-present the same key, and the existing routes' replay
 * short-circuit returns the original transaction instead of paying twice.
 */
export function idempotencyKeyFor(code: string): string {
  return `wa:${s256(code).slice(0, 40)}`;
}

export async function createPendingAction(userId: string, payload: ActionPayload): Promise<string> {
  await ensureWhatsappSchema();
  const code = randomBytes(32).toString("base64url");
  await prisma.$executeRawUnsafe(
    `INSERT INTO wa_pending_actions (code_hash, user_id, kind, payload, expires_at)
     VALUES ($1, $2::uuid, $3, $4::jsonb, now() + make_interval(mins => $5::int))`,
    s256(code),
    userId,
    payload.kind,
    JSON.stringify(payload),
    ACTION_TTL_MINUTES,
  );
  if (Math.random() < 0.05) {
    void prisma
      .$executeRawUnsafe(`DELETE FROM wa_pending_actions WHERE created_at < now() - interval '7 days'`)
      .catch(() => undefined);
  }
  return code;
}

export interface PendingAction {
  payload: ActionPayload;
  approvedAt: Date | null;
  usedAt: Date | null;
}

const gone = () =>
  new ApiError(410, "This payment link has expired or was already used. Ask again on WhatsApp.", "wa_action_gone");

/**
 * Read an action for display.
 *
 * `userId` is not a filter for convenience — it is the authorisation check.
 * Someone who intercepts a link must not be able to see, let alone spend,
 * another person's payment. Mismatch reads the same as "gone", so the reply
 * never confirms that a code exists.
 */
export async function peekPendingAction(code: string, userId: string): Promise<PendingAction> {
  await ensureWhatsappSchema();
  if (!ACTION_CODE.test(code)) throw gone();
  const rows = await prisma.$queryRawUnsafe<
    { user_id: string; payload: unknown; approved_at: Date | null; used_at: Date | null }[]
  >(
    `SELECT user_id, payload, approved_at, used_at FROM wa_pending_actions
      WHERE code_hash = $1 AND expires_at > now()`,
    s256(code),
  );
  const row = rows[0];
  if (!row || row.user_id !== userId) throw gone();
  if (row.used_at) throw gone();
  return {
    payload: row.payload as ActionPayload,
    approvedAt: row.approved_at,
    usedAt: row.used_at,
  };
}

/**
 * Reserve the user's daily cap for this action and mark it approved.
 *
 * Reserved at approval rather than at compose, so a proposal the user ignored
 * never eats their allowance. Held under the same advisory lock the withdrawal
 * limits use, so two links opened at once cannot both read the old total and
 * both pass.
 *
 * Re-approving an already-approved action is a no-op: the user refreshed the
 * page, and charging them twice against their own ceiling would be wrong.
 */
export async function approvePendingAction(code: string, userId: string): Promise<PendingAction> {
  const action = await peekPendingAction(code, userId);
  if (action.approvedAt) return action;

  const amount = amountOf(action.payload);
  const cls = capClassOf(action.payload.kind);
  const capNaira = cls === "p2p" ? await getWhatsappP2pDailyCapKobo() : await getWhatsappSelfDailyCapKobo();
  const cap = BigInt(Math.round(capNaira));

  await prisma.$transaction(async (db) => {
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `wa-cap:${userId}`);
    const used = await usedTodayKobo(userId, cls, db);
    if (used + amount > cap) {
      throw new ApiError(
        403,
        cls === "p2p"
          ? `WhatsApp can send up to ${formatNairaMinor(cap)} a day to other people. You have ${formatNairaMinor(cap - used > 0n ? cap - used : 0n)} left today — open the app to send more.`
          : `WhatsApp can move up to ${formatNairaMinor(cap)} a day. You have ${formatNairaMinor(cap - used > 0n ? cap - used : 0n)} left today — open the app to do more.`,
        "wa_daily_cap",
      );
    }
    await db.$executeRawUnsafe(
      `UPDATE wa_pending_actions SET approved_at = now() WHERE code_hash = $1 AND approved_at IS NULL`,
      s256(code),
    );
  });
  return { ...action, approvedAt: new Date() };
}

type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

/** Today's reserved total for one cap class. Reserved OR spent both count. */
export async function usedTodayKobo(
  userId: string,
  cls: "p2p" | "self",
  db: Db = prisma,
): Promise<bigint> {
  const kinds = cls === "p2p" ? ["transfer"] : ["withdraw", "bill"];
  const rows = await db.$queryRawUnsafe<{ total: string | null }[]>(
    `SELECT COALESCE(SUM((payload->>'amountMinor')::numeric), 0)::text AS total
       FROM wa_pending_actions
      WHERE user_id = $1::uuid
        AND kind = ANY($2::text[])
        AND (approved_at IS NOT NULL OR used_at IS NOT NULL)
        AND COALESCE(approved_at, used_at) >= date_trunc('day', now())`,
    userId,
    kinds,
  );
  return BigInt(rows[0]?.total ?? "0");
}

/**
 * Close the action out once the payment has run.
 *
 * Best effort by design: the deterministic idempotency key already makes a
 * second payment impossible, so a burn that fails is untidy rather than
 * dangerous. Making it load-bearing would put a single point of failure in
 * front of money.
 */
export async function burnPendingAction(code: string, userId: string): Promise<void> {
  await ensureWhatsappSchema();
  if (!ACTION_CODE.test(code)) return;
  await prisma
    .$executeRawUnsafe(
      `UPDATE wa_pending_actions SET used_at = now()
        WHERE code_hash = $1 AND user_id = $2::uuid AND used_at IS NULL`,
      s256(code),
      userId,
    )
    .catch(() => undefined);
}
