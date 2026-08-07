import { Prisma, prisma } from "@cheqpay/db";

/**
 * Usernames are the address book for peer-to-peer transfers: `POST /api/transfers`
 * and `GET /api/users/lookup` can only find a recipient by one. Registration used
 * to leave the column null, so a brand-new account was unreachable until its owner
 * happened to open Personal Details and press Save — which meant P2P silently did
 * not work for almost everyone. Provisioning now assigns one.
 *
 * Canonical form is LOWERCASE. Lookups are case-insensitive, but the database's
 * unique index is not, so without a canonical case two accounts could exist as
 * "Victor" and "victor" and a lookup would resolve to whichever row the planner
 * returned first — money to the wrong person. Storing one case makes that
 * impossible; `ensureUsernameCaseIndex` enforces it at the database level too.
 */

const MIN_LEN = 3;
const MAX_LEN = 20;

/**
 * Derive a candidate username from an email address: the local part, lowercased,
 * with everything outside [a-z0-9_] removed.
 *
 * Returns "" when nothing usable survives (e.g. an all-symbol local part); the
 * caller substitutes a generic base rather than producing an invalid handle.
 */
export function deriveUsernameBase(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, MAX_LEN);
}

/**
 * Build the nth candidate for a base, keeping the result inside MAX_LEN.
 * n === 0 is the bare base; later attempts append a numeric suffix, truncating
 * the base so the suffix always fits.
 */
function candidate(base: string, n: number): string {
  const padded = base.length >= MIN_LEN ? base : `${base}user`.slice(0, MAX_LEN);
  if (n === 0) return padded;
  // Random rather than sequential: sequential probing on a unique index turns
  // every collision into a scan, and leaks how many similar handles exist.
  const suffix = String(Math.floor(Math.random() * 10_000)).padStart(2, "0");
  return `${padded.slice(0, MAX_LEN - suffix.length)}${suffix}`;
}

/**
 * Give `userId` a username if it does not already have one. Best-effort by
 * design: this runs inside login provisioning, and failing to allocate a handle
 * must never block a user from signing in.
 *
 * Race-safe. Two concurrent provisions of the same email would generate the same
 * candidate, so the unique index is the arbiter — a P2002 is a retry, not an
 * error. Returns the username in effect, or null if none could be assigned.
 */
export async function assignUsernameIfMissing(
  userId: string,
  email: string
): Promise<string | null> {
  const base = deriveUsernameBase(email) || "cheqpay";

  for (let attempt = 0; attempt < 6; attempt++) {
    const name = candidate(base, attempt);
    try {
      // Guarded by `username: null` so this can never overwrite a handle the
      // user chose, even if two provisions race.
      const updated = await prisma.user.updateMany({
        where: { id: userId, username: null },
        data: { username: name },
      });
      if (updated.count === 1) return name;

      // Zero rows: the user already has a username (or is gone). Report the
      // existing one so callers can serialize an accurate profile.
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      return current?.username ?? null;
    } catch (err) {
      // Taken — try a different suffix.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      console.error("[username] assignment failed", err);
      return null;
    }
  }

  console.warn(`[username] exhausted candidates for base "${base}"`);
  return null;
}

/**
 * Enforce case-insensitive uniqueness at the database level.
 *
 * Migrations are not applied on deploy in this project (see ensureCards,
 * ensureBeneficiaries, ensureCashbackEnum, ensureTransferEnums), so this runs
 * lazily and idempotently. It lowercases any pre-existing mixed-case handle
 * first, otherwise the index creation would fail on legacy rows.
 */
let ensured: Promise<void> | null = null;

export function ensureUsernameCaseIndex(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE app_users SET username = lower(username)
         WHERE username IS NOT NULL AND username <> lower(username)
           AND lower(username) NOT IN (
             SELECT lower(username) FROM app_users
             WHERE username IS NOT NULL GROUP BY lower(username) HAVING count(*) > 1
           )`
      );
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_lower_key
         ON app_users (lower(username))`
      );
    })().catch((err) => {
      ensured = null; // allow retry on the next provision
      throw err;
    });
  }
  return ensured;
}
