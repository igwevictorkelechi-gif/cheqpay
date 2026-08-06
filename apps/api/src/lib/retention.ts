import { Prisma, prisma, UserStatus } from "@cheqpay/db";
import { randomUUID } from "node:crypto";

/**
 * Record retention for AML compliance.
 *
 * Nigeria's Money Laundering (Prevention and Prohibition) Act 2022 and the CBN
 * AML/CFT regulations require customer identification and transaction records
 * to be kept for at least five years after the business relationship ends, and
 * to be producible to the authorities on request.
 *
 * That is in direct tension with account deletion, and the tension is resolved
 * the way regulated institutions resolve it: an erasure request does not
 * override statutory retention. Closing an account therefore
 *
 *   - scrubs the live profile of everything not required to be kept,
 *   - snapshots the regulated identity into `retained_subjects`,
 *   - and leaves the transaction and KYC history intact.
 *
 * It does NOT delete the User row. Transaction and KycRecord both cascade on
 * user deletion, so a hard delete would erase precisely the evidence an
 * investigation needs. Keeping the row is what stops the cascade from firing.
 */

/** Statutory minimum in Nigeria. Five years from the end of the relationship. */
export const RETENTION_YEARS = 5;

export function retainUntilFrom(closedAt: Date): Date {
  const d = new Date(closedAt);
  d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS);
  return d;
}

/**
 * Create the retention schema if it is not already present.
 *
 * Migrations are not applied on deploy in this project (see ensureCards,
 * ensureBeneficiaries, ensureTransfers), so the DDL runs lazily and
 * idempotently before first use.
 */
let ensured: Promise<void> | null = null;

export function ensureRetentionSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'DELETED'`
      );
      for (const col of [
        `legal_name TEXT`,
        `bvn_ciphertext TEXT`,
        `bvn_fingerprint TEXT`,
        `bvn_last4 TEXT`,
      ]) {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS ${col}`
        );
      }
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS app_users_bvn_fingerprint_idx ON app_users (bvn_fingerprint)`
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS app_users_legal_name_idx ON app_users (legal_name)`
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS retained_subjects (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL UNIQUE,
          legal_name TEXT,
          email TEXT NOT NULL,
          phone TEXT,
          username TEXT,
          date_of_birth DATE,
          bvn_ciphertext TEXT,
          bvn_fingerprint TEXT,
          bvn_last4 TEXT,
          kyc_tier INTEGER NOT NULL,
          reason TEXT NOT NULL,
          retain_until TIMESTAMP NOT NULL,
          closed_at TIMESTAMP NOT NULL DEFAULT now()
        )`);
      for (const idx of ["bvn_fingerprint", "email", "phone", "legal_name"]) {
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS retained_subjects_${idx}_idx ON retained_subjects (${idx})`
        );
      }
    })().catch((err) => {
      ensured = null; // allow retry
      throw err;
    });
  }
  return ensured;
}

/**
 * Close an account: snapshot the regulated identity, then scrub the live
 * profile. Returns the retention expiry so the caller can tell the user how
 * long records are kept — which the NDPA requires them to be told.
 *
 * Runs in a single transaction: a snapshot without a scrub leaves personal data
 * in two places, and a scrub without a snapshot destroys the record entirely.
 * Neither half is acceptable on its own.
 */
export async function closeAccountWithRetention(
  userId: string,
  reason = "account_deleted"
): Promise<{ retainUntil: Date }> {
  await ensureRetentionSchema();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  const closedAt = new Date();
  const retainUntil = retainUntilFrom(closedAt);

  // Unique columns cannot simply be nulled to a shared value, and must not keep
  // the real address: a tombstone that is unique per account and obviously not
  // a real mailbox.
  const tombstone = `deleted-${randomUUID()}@deleted.cheqpay.invalid`;

  await prisma.$transaction(async (db) => {
    await db.$executeRaw`
      INSERT INTO retained_subjects (
        user_id, legal_name, email, phone, username, date_of_birth,
        bvn_ciphertext, bvn_fingerprint, bvn_last4, kyc_tier, reason,
        retain_until, closed_at
      ) VALUES (
        ${user.id}::uuid, ${user.legalName}, ${user.email}, ${user.phone},
        ${user.username}, ${user.dateOfBirth}::date,
        ${user.bvnCiphertext}, ${user.bvnFingerprint}, ${user.bvnLast4},
        ${user.kycTier}, ${reason}, ${retainUntil}, ${closedAt}
      )
      ON CONFLICT (user_id) DO NOTHING`;

    // Scrub what is not required to be retained. kycTier and createdAt stay:
    // they describe the account, not the person, and the ledger references them.
    await db.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        email: tombstone,
        phone: null,
        username: null,
        legalName: null,
        nextOfKin: null,
        dateOfBirth: null,
        bvnCiphertext: null,
        bvnFingerprint: null,
        bvnLast4: null,
        passwordHash: null,
        notificationPrefs: Prisma.DbNull,
        pushTokens: [],
      },
    });
  });

  return { retainUntil };
}
