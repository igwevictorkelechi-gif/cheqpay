// apps/api/src/lib/ajo/lien.ts
//
// The group Ajo lien. A member who misses a contribution owes it to that
// round's collector. Until it is paid:
//   - money that comes into their naira wallet goes to the group first
//     (sweepArrears in groups.ts, run every minute by the scheduler); and
//   - money-out routes (withdrawals, transfers, bills, purchases) refuse with
//     `ajo_arrears`, so the money can't be moved away before it's swept.
// Members agree to this when they join a group.

import { prisma } from "@cheqpay/db";
import { ApiError } from "@/lib/http";
import { formatNairaMinor } from "@/lib/money";

type Db = Pick<typeof prisma, "$queryRaw">;

/** True for "relation does not exist": no Ajo table yet means nobody owes anything. */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  return e?.code === "42P01" || e?.meta?.code === "42P01" || /relation "ajo_[a-z_]+" does not exist/.test(String(e?.message ?? ""));
}

/** What a user owes across all their Ajo groups, in kobo. */
export async function ajoArrearsKobo(userId: string, db: Db = prisma): Promise<bigint> {
  try {
    const rows = await db.$queryRaw<{ owed: bigint | null }[]>`
      SELECT COALESCE(SUM(amount_minor - paid_minor), 0)::bigint AS owed
      FROM ajo_contributions WHERE user_id = ${userId}::uuid AND status <> 'paid'`;
    return BigInt(rows[0]?.owed ?? 0n);
  } catch (err) {
    if (isMissingTable(err)) return 0n;
    throw err;
  }
}

/** Refuse a money-out action while the user owes their Ajo group. */
export async function assertNoAjoArrears(userId: string, db: Db = prisma): Promise<void> {
  const owed = await ajoArrearsKobo(userId, db);
  if (owed > 0n) {
    throw new ApiError(
      423,
      `You owe ${formatNairaMinor(owed)} to your Ajo group. Add money to your wallet to catch up: it goes to your group first, and withdrawals and transfers open again as soon as you're up to date.`,
      "ajo_arrears",
    );
  }
}
