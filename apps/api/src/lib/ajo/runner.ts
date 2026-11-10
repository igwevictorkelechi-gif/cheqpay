// apps/api/src/lib/ajo/runner.ts
//
// Shared by the scheduler loops in personal.ts and groups.ts. One bad row
// (a deadlock, a constraint, a group with no collector) must not stall every
// other plan and group behind it, so each loop skips a row that failed for
// the rest of the pass and tells ops once.

import { Prisma } from "@cheqpay/db";
import { alertOpsOnce } from "@/lib/opsAlert";

/** An error inside a claimed row's transaction, tagged with that row's id. */
export class RowError extends Error {
  constructor(
    public readonly rowId: string,
    public readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "RowError";
  }
}

/** Run `fn` for a claimed row; any failure comes back tagged with its id. */
export async function tagged<T>(rowId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw err instanceof RowError ? err : new RowError(rowId, err);
  }
}

/** `AND id NOT IN (...)` for the rows already skipped this pass, or nothing. */
export function notIn(ids: readonly string[]): Prisma.Sql {
  return ids.length ? Prisma.sql`AND id NOT IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty;
}

/**
 * Handle one loop failure: a RowError is skipped for the rest of the pass and
 * reported once an hour per row; anything else (the database is down) stops
 * the pass by rethrowing, since no row would succeed.
 */
export async function skipOrThrow(what: string, err: unknown, skipped: string[]): Promise<void> {
  if (!(err instanceof RowError)) throw err;
  skipped.push(err.rowId);
  console.error(`[ajo] ${what} ${err.rowId} failed; skipped for this pass`, err.cause);
  await alertOpsOnce(`ajo:${what}:${err.rowId}`, `Ajo ${what} ${err.rowId} failed and was skipped: ${err.message}`.slice(0, 500));
}
