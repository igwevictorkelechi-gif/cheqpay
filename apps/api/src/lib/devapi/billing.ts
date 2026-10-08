// apps/api/src/lib/devapi/billing.ts
//
// Plan subscriptions, paid monthly from the developer's main NGN wallet (live).
//
//   subscribe  pay the full month now; the period starts now
//   upgrade    switch now, pay the prorated difference for the rest of the period
//   downgrade  switch at the end of the period (nothing to pay or refund)
//   cancel     stop at the end of the period
//
// Every change runs holding a lock on the subscription row and re-checks state
// under it, so a double click or a retried request can't charge twice: the
// second attempt finds the plan already changed (or the period already moved
// on) and does nothing.
//
// Renewal is daily (cron). A failed renewal makes the subscription past_due;
// live keys keep working for a 3-day grace while the developer tops up, then
// stop with 402 until it is paid.

import { prisma, type Prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import { ensureDevApiSchema } from "./ensureDevApi";
import { applyLegs, ensureMainWallets, getMainWallet, insertTransaction } from "./ledger";
import { getPlans, isPaidPlanId, type DevPlan, type PlanId } from "./plans";
import { emailOwner, recordDevAudit } from "./audit";
import { invalidateKeyCache } from "./keys";
import type { AccountRow, SubscriptionRow } from "./types";

export const GRACE_MS = 3 * 86_400_000;

/** One calendar month later, clamped to the month's end (31 Jan → 28/29 Feb). */
export function addMonth(d: Date): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()),
  );
}

/** What an upgrade costs for the rest of the period: the price difference × time left, rounded up to the kobo. */
export function prorate(oldPriceMinor: number, newPriceMinor: number, start: Date, end: Date, now: Date): bigint {
  const diff = BigInt(newPriceMinor - oldPriceMinor);
  if (diff <= 0n) return 0n;
  const total = BigInt(Math.max(1, end.getTime() - start.getTime()));
  const left = BigInt(Math.max(0, Math.min(end.getTime() - now.getTime(), end.getTime() - start.getTime())));
  return (diff * left + total - 1n) / total;
}

export async function getSubscription(accountId: string): Promise<SubscriptionRow | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<SubscriptionRow[]>(`SELECT * FROM dev_subscriptions WHERE account_id = $1::uuid`, accountId);
  return rows[0] ?? null;
}

/**
 * Why live mode is closed to this account right now, or null if it's open.
 * The same answer drives the API gate and the dashboard.
 */
export function liveAccessProblem(
  account: Pick<AccountRow, "status">,
  sub: SubscriptionRow | null,
  plans: Record<PlanId, DevPlan>,
  now: Date = new Date(),
): { status: number; code: string; message: string } | null {
  if (account.status !== "approved") {
    return { status: 403, code: "account_not_approved", message: "Live mode needs a verified business. Complete business verification in your dashboard." };
  }
  const inactive = { status: 402, code: "subscription_inactive", message: "Live mode needs an active paid plan. Renew or choose a plan in your dashboard." };
  if (!sub || !isPaidPlanId(sub.plan_id) || !plans[sub.plan_id].live) return inactive;
  if (sub.status === "canceled") return inactive;
  if (sub.status === "past_due") {
    const since = sub.past_due_since ?? sub.current_period_end;
    return now.getTime() - since.getTime() <= GRACE_MS ? null : inactive;
  }
  // Active but not yet renewed (the cron runs daily): the same grace applies.
  return now.getTime() - sub.current_period_end.getTime() <= GRACE_MS ? null : inactive;
}

async function lockSubscription(db: Prisma.TransactionClient, accountId: string): Promise<SubscriptionRow | null> {
  const rows = await db.$queryRawUnsafe<SubscriptionRow[]>(
    `SELECT * FROM dev_subscriptions WHERE account_id = $1::uuid FOR UPDATE`,
    accountId,
  );
  return rows[0] ?? null;
}

/** Take a plan charge from the live main NGN wallet. Throws insufficient_funds when it can't. */
async function chargePlan(
  db: Prisma.TransactionClient,
  account: AccountRow,
  amountMinor: bigint,
  details: Record<string, unknown>,
  description: string,
  initiatorIp: string | null = null,
): Promise<string | null> {
  if (amountMinor <= 0n) return null;
  await ensureMainWallets(db, account.id, "live");
  const wallet = (await getMainWallet(db, account.id, "live", "NGN"))!;
  const txId = await insertTransaction(db, {
    accountId: account.id,
    mode: "live",
    kind: "subscription",
    status: "successful",
    currency: "NGN",
    amountMinor,
    walletId: wallet.id,
    description,
    details,
    initiatorIp,
  });
  try {
    await applyLegs(db, { accountId: account.id, mode: "live" }, txId, "NGN", [
      { walletId: wallet.id, amountMinor: -amountMinor, kind: "subscription" },
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.code === "insufficient_funds") {
      throw new ApiError(422, "Your main NGN wallet doesn't hold enough for this plan. Add money first.", "insufficient_funds");
    }
    throw err;
  }
  return txId;
}

export type PlanChange =
  | { kind: "subscribed"; chargedMinor: bigint }
  | { kind: "upgraded"; chargedMinor: bigint }
  | { kind: "downgrade_scheduled" }
  | { kind: "resumed" }
  | { kind: "unchanged" };

/** Choose a paid plan: subscribe, upgrade (now, prorated) or downgrade (at period end). */
export async function changePlan(account: AccountRow, planId: string, actor: { ip: string | null; userAgent: string | null }, now: Date = new Date()): Promise<PlanChange> {
  if (!isPaidPlanId(planId)) throw new ApiError(400, "Choose Starter, Growth or Scale.", "validation_error");
  if (account.status !== "approved") {
    throw new ApiError(403, "Plans are for verified businesses. Complete business verification first.", "account_not_approved");
  }
  if (account.frozen) throw new ApiError(403, "Money movement is paused on this account.", "account_frozen");
  const plans = await getPlans();
  const plan = plans[planId];
  await ensureDevApiSchema();

  const change = await prisma.$transaction(async (db): Promise<PlanChange> => {
    const sub = await lockSubscription(db, account.id);
    const current = sub && isPaidPlanId(sub.plan_id) ? plans[sub.plan_id] : null;
    const usable = sub && liveAccessProblem(account, sub, plans, now) === null && sub.status !== "canceled";

    if (!sub || !usable || !current) {
      // New subscription (or a lapsed one starting over): a full month from now.
      const end = addMonth(now);
      const charged = BigInt(plan.priceMinor);
      await chargePlan(db, account, charged, { plan_id: planId, period_start: now.toISOString(), period_end: end.toISOString() }, `${plan.name} plan`, actor.ip);
      await db.$executeRawUnsafe(
        `INSERT INTO dev_subscriptions (account_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1::uuid, $2, 'active', $3, $4)
         ON CONFLICT (account_id) DO UPDATE SET plan_id = $2, status = 'active', current_period_start = $3, current_period_end = $4,
           cancel_at_period_end = false, next_plan_id = NULL, past_due_since = NULL, updated_at = now()`,
        account.id,
        planId,
        now,
        end,
      );
      return { kind: "subscribed", chargedMinor: charged };
    }

    if (sub.plan_id === planId) {
      if (sub.cancel_at_period_end || sub.next_plan_id) {
        await db.$executeRawUnsafe(
          `UPDATE dev_subscriptions SET cancel_at_period_end = false, next_plan_id = NULL, updated_at = now() WHERE account_id = $1::uuid`,
          account.id,
        );
        return { kind: "resumed" };
      }
      return { kind: "unchanged" };
    }

    if (plan.priceMinor > current.priceMinor) {
      const charged = prorate(current.priceMinor, plan.priceMinor, sub.current_period_start, sub.current_period_end, now);
      await chargePlan(
        db,
        account,
        charged,
        { plan_id: planId, from_plan_id: sub.plan_id, prorated: true, period_end: sub.current_period_end.toISOString() },
        `Upgrade to ${plan.name}`,
        actor.ip,
      );
      await db.$executeRawUnsafe(
        `UPDATE dev_subscriptions SET plan_id = $2, cancel_at_period_end = false, next_plan_id = NULL, updated_at = now()
          WHERE account_id = $1::uuid`,
        account.id,
        planId,
      );
      return { kind: "upgraded", chargedMinor: charged };
    }

    await db.$executeRawUnsafe(
      `UPDATE dev_subscriptions SET next_plan_id = $2, cancel_at_period_end = false, updated_at = now() WHERE account_id = $1::uuid`,
      account.id,
      planId,
    );
    return { kind: "downgrade_scheduled" };
  }, { maxWait: 10_000, timeout: 15_000 });

  invalidateKeyCache();
  await recordDevAudit({
    accountId: account.id,
    actor: "owner",
    action: `plan.${change.kind}`,
    details: { plan_id: planId, ...("chargedMinor" in change ? { charged_minor: change.chargedMinor.toString() } : {}) },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return change;
}

/** Stop at the end of the current period. */
export async function cancelPlan(account: AccountRow, actor: { ip: string | null; userAgent: string | null }): Promise<SubscriptionRow> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<SubscriptionRow[]>(
    `UPDATE dev_subscriptions SET cancel_at_period_end = true, next_plan_id = NULL, updated_at = now()
      WHERE account_id = $1::uuid AND status <> 'canceled' RETURNING *`,
    account.id,
  );
  if (!rows[0]) throw new ApiError(404, "You don't have an active plan.", "not_found");
  await recordDevAudit({ accountId: account.id, actor: "owner", action: "plan.cancel_scheduled", ip: actor.ip, userAgent: actor.userAgent });
  return rows[0];
}

export interface RenewalSummary {
  renewed: number;
  pastDue: number;
  canceled: number;
}

/**
 * Renew every subscription whose period has ended. Exactly once per period by
 * construction: the charge and the move to the next period commit together
 * under the row lock, after which the subscription no longer looks due.
 */
export async function renewDueSubscriptions(now: Date = new Date()): Promise<RenewalSummary> {
  await ensureDevApiSchema();
  const due = await prisma.$queryRawUnsafe<{ account_id: string }[]>(
    `SELECT account_id FROM dev_subscriptions WHERE status IN ('active', 'past_due') AND current_period_end <= $1 LIMIT 500`,
    now,
  );
  const plans = await getPlans();
  const out: RenewalSummary = { renewed: 0, pastDue: 0, canceled: 0 };

  for (const { account_id } of due) {
    const accounts = await prisma.$queryRawUnsafe<AccountRow[]>(`SELECT * FROM dev_accounts WHERE id = $1::uuid`, account_id);
    const account = accounts[0];
    if (!account) continue;
    let outcome: "renewed" | "past_due" | "canceled" | "skip" = "skip";
    let failedPlan: DevPlan | null = null;
    try {
      outcome = await prisma.$transaction(async (db) => {
        const sub = await lockSubscription(db, account_id);
        if (!sub || sub.current_period_end > now || sub.status === "canceled") return "skip";
        const lapsedTooLong = sub.status === "past_due" && sub.past_due_since && now.getTime() - sub.past_due_since.getTime() > 30 * 86_400_000;
        if (sub.cancel_at_period_end || lapsedTooLong || account.status !== "approved" || account.frozen) {
          await db.$executeRawUnsafe(
            `UPDATE dev_subscriptions SET status = 'canceled', updated_at = now() WHERE account_id = $1::uuid`,
            account_id,
          );
          return "canceled";
        }
        const planId = (sub.next_plan_id && isPaidPlanId(sub.next_plan_id) ? sub.next_plan_id : sub.plan_id) as PlanId;
        const plan = isPaidPlanId(planId) ? plans[planId] : null;
        if (!plan) {
          await db.$executeRawUnsafe(`UPDATE dev_subscriptions SET status = 'canceled', updated_at = now() WHERE account_id = $1::uuid`, account_id);
          return "canceled";
        }
        // On time: the new period follows on from the old one. Paid late (after
        // falling past due): it starts now, since live access lapsed meanwhile.
        const start = now.getTime() - sub.current_period_end.getTime() < 86_400_000 ? sub.current_period_end : now;
        const end = addMonth(start);
        try {
          await db.$executeRawUnsafe(`SAVEPOINT renew`);
          await chargePlan(db, account, BigInt(plan.priceMinor), { plan_id: planId, period_start: start.toISOString(), period_end: end.toISOString(), renewal: true }, `${plan.name} plan`);
          await db.$executeRawUnsafe(`RELEASE SAVEPOINT renew`);
        } catch (err) {
          if (!(err instanceof ApiError && err.code === "insufficient_funds")) throw err;
          await db.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT renew`);
          await db.$executeRawUnsafe(
            `UPDATE dev_subscriptions SET status = 'past_due', past_due_since = COALESCE(past_due_since, $2), updated_at = now()
              WHERE account_id = $1::uuid`,
            account_id,
            now,
          );
          failedPlan = plan;
          return "past_due";
        }
        await db.$executeRawUnsafe(
          `UPDATE dev_subscriptions SET plan_id = $2, status = 'active', current_period_start = $3, current_period_end = $4,
             next_plan_id = NULL, past_due_since = NULL, updated_at = now() WHERE account_id = $1::uuid`,
          account_id,
          planId,
          start,
          end,
        );
        return "renewed";
      }, { maxWait: 10_000, timeout: 15_000 });
    } catch (err) {
      console.error("[devapi] renewal failed", { account: account_id, error: String(err) });
      continue;
    }
    if (outcome === "renewed") out.renewed++;
    if (outcome === "canceled") out.canceled++;
    if (outcome === "past_due") {
      out.pastDue++;
      const plan = failedPlan as DevPlan | null;
      emailOwner(account, {
        title: "We couldn't renew your plan",
        body: `Your main NGN wallet didn't hold enough to renew${plan ? ` the ${plan.name} plan` : " your plan"}. Live API keys keep working for 3 days — add money to your main wallet and we'll retry automatically.`,
      });
    }
  }
  if (out.renewed || out.canceled || out.pastDue) invalidateKeyCache();
  return out;
}
