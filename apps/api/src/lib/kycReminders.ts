// apps/api/src/lib/kycReminders.ts
//
// Nudge people who signed up but never verified their identity. An unverified
// account (tier 0) has zero limits — it cannot deposit, send or withdraw — so
// a sign-up that stops at KYC is a customer we have already lost unless we ask
// again.
//
// At most three reminders per person, spaced out so they read as reminders
// and not spam: the first a day after sign-up, the second two days after the
// first, the last four days after that. For a new sign-up that is day 1, 3
// and 7. Anyone already waiting on a manual review, or whom an admin has
// rejected, is left alone.
//
// Sends go through notifyUser, so push, web push and email all honour the
// person's "Updates" notification preference.

import { prisma } from "@cheqpay/db";
import { notifyUser } from "./alerts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Wait before reminder n (0-based): from sign-up for the first, then from the previous one. */
export const REMINDER_GAPS_DAYS = [1, 2, 4] as const;
export const MAX_REMINDERS = REMINDER_GAPS_DAYS.length;

/** Most reminders one run sends — keeps the job well inside the function timeout. */
export const REMINDER_BATCH = 200;

export const KYC_URL = "https://mycheqpay.com/kyc";

let ensured: Promise<void> | null = null;

/** The table that remembers who has been reminded. Created on first use. */
export function ensureKycRemindersSchema(): Promise<void> {
  if (!ensured) {
    ensured = prisma
      .$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS kyc_reminders (
          user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          sent_count INTEGER NOT NULL DEFAULT 0,
          last_sent_at TIMESTAMP NOT NULL DEFAULT now()
        )`)
      .then(() => undefined)
      .catch((err) => {
        ensured = null; // allow retry
        throw err;
      });
  }
  return ensured;
}

/** Whether a person is due their next reminder. */
export function reminderDue(
  signedUpAt: Date,
  sentCount: number,
  lastSentAt: Date | null,
  now: Date = new Date()
): boolean {
  if (sentCount >= MAX_REMINDERS) return false;
  const since = sentCount === 0 || !lastSentAt ? signedUpAt : lastSentAt;
  return now.getTime() - since.getTime() >= REMINDER_GAPS_DAYS[sentCount] * DAY_MS;
}

/** The words for reminder n (0-based). Each one says what verifying unlocks. */
export function reminderMessage(sentCount: number): { title: string; body: string } {
  switch (sentCount) {
    case 0:
      return {
        title: "Finish setting up your account",
        body: "Verify your identity with your BVN to start adding money, sending and withdrawing. It takes about 2 minutes.",
      };
    case 1:
      return {
        title: "Your account is almost ready",
        body: "One step left: verify your identity to unlock deposits, transfers, bill payments and your dollar card.",
      };
    default:
      return {
        title: "Still want to use CheqPay?",
        body: "Your account can't move money until you verify your identity. Verify now — it only takes a couple of minutes.",
      };
  }
}

interface Candidate {
  id: string;
  created_at: Date;
  sent_count: number | null;
  last_sent_at: Date | null;
}

/**
 * Unverified, active accounts that have not had every reminder yet and have
 * nothing waiting on (or refused by) a reviewer. Oldest reminder first, so a
 * run that hits the batch limit does not starve the same people every day.
 */
async function candidates(limit: number): Promise<Candidate[]> {
  return prisma.$queryRawUnsafe<Candidate[]>(
    `SELECT u.id, u.created_at, r.sent_count, r.last_sent_at
       FROM app_users u
       LEFT JOIN kyc_reminders r ON r.user_id = u.id
      WHERE u.status = 'ACTIVE'
        AND u.kyc_tier = 0
        AND u.created_at <= now() - interval '1 day'
        AND COALESCE(r.sent_count, 0) < $1
        AND NOT EXISTS (
          SELECT 1 FROM kyc_records k
           WHERE k.user_id = u.id AND k.status IN ('PENDING', 'REJECTED'))
      ORDER BY r.last_sent_at ASC NULLS FIRST, u.created_at ASC
      LIMIT $2`,
    MAX_REMINDERS,
    limit
  );
}

async function recordSent(userId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO kyc_reminders (user_id, sent_count, last_sent_at)
     VALUES ($1::uuid, 1, now())
     ON CONFLICT (user_id) DO UPDATE
       SET sent_count = kyc_reminders.sent_count + 1, last_sent_at = now()`,
    userId
  );
}

export interface ReminderRunResult {
  checked: number;
  sent: number;
  failed: number;
}

/** Send every reminder that is due, up to `limit`. */
export async function sendKycReminders(
  now: Date = new Date(),
  limit: number = REMINDER_BATCH
): Promise<ReminderRunResult> {
  await ensureKycRemindersSchema();
  // Fetch more than we send: some candidates are not due yet (gap not passed).
  const rows = await candidates(limit * 3);
  const due = rows
    .filter((r) => reminderDue(new Date(r.created_at), r.sent_count ?? 0, r.last_sent_at ? new Date(r.last_sent_at) : null, now))
    .slice(0, limit);

  let sent = 0;
  let failed = 0;
  // A few at a time: each send is a push, a web push and an email.
  const CONCURRENCY = 8;
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    await Promise.all(
      due.slice(i, i + CONCURRENCY).map(async (r) => {
        const count = r.sent_count ?? 0;
        try {
          await notifyUser(r.id, {
            ...reminderMessage(count),
            category: "updates",
            data: { url: "/kyc", type: "kyc_reminder" },
            action: { label: "Verify now", url: KYC_URL },
          });
          // Counted even when the person has every channel off, so an
          // unreachable account is not re-selected on every run forever.
          await recordSent(r.id);
          sent++;
        } catch (err) {
          failed++;
          console.error("[kyc-reminders] send failed", {
            userId: r.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );
  }
  return { checked: rows.length, sent, failed };
}
