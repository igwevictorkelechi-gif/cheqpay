// apps/api/src/lib/nextUp.ts
//
// "Next up" on Home: the money that will move on its own soon, soonest first.
// Built entirely from schedules that already exist, so it promises nothing the
// runners won't do:
//
//   - a personal Ajo plan's next auto-save        (ajo_plans.next_due_at)
//   - an Ajo circle's next round                   (ajo_groups.next_due_at)
//       · your turn to collect, if your position is the current round
//       · otherwise your contribution
//   - a saved bill's autopay day                    (saved_bills.autopay_day)
//
// Read-only. Nothing here moves money.

import { prisma } from "@cheqpay/db";
import { ensureAjoSchema } from "./ajo/schema";
import { ensureSavedBillsSchema } from "./savedBills";

export type NextUpKind = "ajo_plan" | "ajo_contribution" | "ajo_collect" | "bill_autopay";

export interface NextUpItem {
  kind: NextUpKind;
  id: string;
  title: string;
  /** The line under the title, e.g. "12 of 20" or "Your turn — you collect". */
  detail: string;
  dueAt: string;
  /** Kobo, as a string. Null when the amount isn't known in advance (a bill with no fixed amount). */
  amountMinor: string | null;
  direction: "in" | "out";
}

/** How far ahead Home looks, and how many rows it shows. */
export const NEXT_UP_WINDOW_DAYS = 31;
export const NEXT_UP_LIMIT = 3;

/** The autopay cron runs at 08:05 Lagos, i.e. 07:05 UTC (vercel.json "5 7 * * *"). */
const AUTOPAY_UTC_HOUR = 7;
const AUTOPAY_UTC_MINUTE = 5;

/**
 * When a saved bill's autopay next runs: its day this month if that is still
 * ahead and it hasn't already run this month, otherwise its day next month.
 */
export function nextAutopayAt(day: number, lastRun: Date | null, now: Date): Date {
  const at = (y: number, m: number) => new Date(Date.UTC(y, m, day, AUTOPAY_UTC_HOUR, AUTOPAY_UTC_MINUTE));
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const ranThisMonth = lastRun !== null && lastRun.getUTCFullYear() === y && lastRun.getUTCMonth() === m;
  const thisMonth = at(y, m);
  return !ranThisMonth && thisMonth > now ? thisMonth : at(y, m + 1);
}

/** Soonest first, inside the window, at most `limit`. */
export function pickNextUp(items: NextUpItem[], now: Date, limit = NEXT_UP_LIMIT): NextUpItem[] {
  const horizon = now.getTime() + NEXT_UP_WINDOW_DAYS * 86_400_000;
  return items
    .filter((i) => {
      const t = new Date(i.dueAt).getTime();
      return t > now.getTime() - 60_000 && t <= horizon;
    })
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .slice(0, limit);
}

/** One round of a circle, from this member's side. */
export function circleItem(
  g: { id: string; name: string; amount_minor: bigint; size: number; current_round: number; next_due_at: Date },
  myPosition: number | null,
): NextUpItem {
  const collecting = myPosition !== null && myPosition === g.current_round;
  // The collector's own share never leaves their wallet, so what arrives is
  // everyone else's: (size − 1) × amount. Matches runRound in ajo/groups.ts.
  const amount = collecting ? g.amount_minor * BigInt(g.size - 1) : g.amount_minor;
  return {
    kind: collecting ? "ajo_collect" : "ajo_contribution",
    id: g.id,
    title: g.name,
    detail: collecting ? "Your turn — you collect" : `Round ${g.current_round} of ${g.size}`,
    dueAt: g.next_due_at.toISOString(),
    amountMinor: amount.toString(),
    direction: collecting ? "in" : "out",
  };
}

export async function nextUpFor(userId: string, now = new Date()): Promise<NextUpItem[]> {
  await Promise.all([ensureAjoSchema(), ensureSavedBillsSchema()]);
  const [plans, groups, bills] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; amount_minor: bigint; paid_count: number; total_count: number; next_due_at: Date }[]>`
      SELECT id::text, name, amount_minor, paid_count, total_count, next_due_at
        FROM ajo_plans
       WHERE user_id = ${userId}::uuid AND status = 'active' AND next_due_at IS NOT NULL`,
    prisma.$queryRaw<{ id: string; name: string; amount_minor: bigint; size: number; current_round: number; next_due_at: Date; position: number | null }[]>`
      SELECT g.id::text, g.name, g.amount_minor, g.size, g.current_round, g.next_due_at, m.position
        FROM ajo_groups g
        JOIN ajo_members m ON m.group_id = g.id AND m.user_id = ${userId}::uuid
       WHERE g.status = 'active' AND g.next_due_at IS NOT NULL`,
    prisma.$queryRaw<{ id: string; nickname: string; amount_minor: bigint | null; autopay_day: number; autopay_last_run: Date | null }[]>`
      SELECT id::text, nickname, amount_minor, autopay_day, autopay_last_run
        FROM saved_bills
       WHERE user_id = ${userId}::uuid AND autopay AND autopay_day IS NOT NULL`,
  ]);

  const items: NextUpItem[] = [
    ...plans.map(
      (p): NextUpItem => ({
        kind: "ajo_plan",
        id: p.id,
        title: p.name,
        detail: `${p.paid_count + 1} of ${p.total_count}`,
        dueAt: new Date(p.next_due_at).toISOString(),
        amountMinor: BigInt(p.amount_minor).toString(),
        direction: "out",
      }),
    ),
    ...groups.map((g) =>
      circleItem({ ...g, amount_minor: BigInt(g.amount_minor), next_due_at: new Date(g.next_due_at) }, g.position),
    ),
    ...bills.map(
      (b): NextUpItem => ({
        kind: "bill_autopay",
        id: b.id,
        title: b.nickname,
        detail: "Autopay",
        dueAt: nextAutopayAt(b.autopay_day, b.autopay_last_run ? new Date(b.autopay_last_run) : null, now).toISOString(),
        amountMinor: b.amount_minor === null ? null : BigInt(b.amount_minor).toString(),
        direction: "out",
      }),
    ),
  ];
  return pickNextUp(items, now);
}
