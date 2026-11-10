// apps/api/src/lib/ajo/wallet.ts
//
// The two naira moves Ajo makes inside a transaction. The debit is guarded
// (no row changes when the balance is short), so callers get a yes/no rather
// than an overdraft. Shared by personal.ts and groups.ts so a change to the
// guard lands in one place.

import { Asset, type Prisma } from "@cheqpay/db";

type Tx = Prisma.TransactionClient;

/** Take `kobo` from the user's spendable naira, or do nothing and return false. */
export async function debitNgn(db: Tx, userId: string, kobo: bigint): Promise<boolean> {
  if (kobo <= 0n) return false;
  const r = await db.balance.updateMany({
    where: { userId, asset: Asset.NGN, available: { gte: kobo } },
    data: { available: { decrement: kobo } },
  });
  return r.count === 1;
}

/** Add `kobo` to the user's spendable naira, creating the row if they have none. */
export async function creditNgn(db: Tx, userId: string, kobo: bigint): Promise<void> {
  if (kobo <= 0n) return;
  await db.balance.upsert({
    where: { userId_asset: { userId, asset: Asset.NGN } },
    update: { available: { increment: kobo } },
    create: { userId, asset: Asset.NGN, available: kobo },
  });
}

/** The later of a stored due date and now: after downtime, one round runs, not every missed one. */
export function laterOf(due: Date | null, now = new Date()): Date {
  return due && due.getTime() > now.getTime() ? due : now;
}
