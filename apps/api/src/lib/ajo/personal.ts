// apps/api/src/lib/ajo/personal.ts
//
// Personal Ajo: a user saves a fixed amount daily, weekly or monthly into a
// pot only they can take out. The first contribution is taken when the plan
// is created; the rest are auto-debited on their due dates (08:00 UTC). When
// the last one is due, everything saved returns to the wallet free. Breaking
// a plan early returns it minus the Ajo break fee.
//
// Money never leaves the user: contributions move naira from their wallet into
// the plan (AJO_SAVE) and back (AJO_RELEASE). Each move is one database
// transaction with a balance guard, keyed so that it can happen only once.

import { Asset, Prisma, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { ApiError } from "@/lib/http";
import { formatNairaMinor } from "@/lib/money";
import { getTierLimits } from "@/lib/kyc";
import { getAjoBreakFeeBps } from "@/lib/settings";
import { notifyUser } from "@/lib/alerts";
import { ensureAjoSchema } from "./schema";
import { ajoArrearsKobo, assertNoAjoArrears } from "./lien";
import { PLAN_MIN_TIER, breakFee, nextDueAfter, planProblem, type Frequency } from "./rules";

type Tx = Prisma.TransactionClient;

export interface PlanRow {
  id: string;
  user_id: string;
  name: string;
  amount_minor: bigint;
  frequency: Frequency;
  total_count: number;
  paid_count: number;
  missed_count: number;
  saved_minor: bigint;
  status: "active" | "matured" | "broken";
  next_due_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
}

const naira = formatNairaMinor;

async function debitNgn(db: Tx, userId: string, kobo: bigint): Promise<boolean> {
  const r = await db.balance.updateMany({
    where: { userId, asset: Asset.NGN, available: { gte: kobo } },
    data: { available: { decrement: kobo } },
  });
  return r.count === 1;
}

async function creditNgn(db: Tx, userId: string, kobo: bigint): Promise<void> {
  if (kobo <= 0n) return;
  await db.balance.upsert({
    where: { userId_asset: { userId, asset: Asset.NGN } },
    update: { available: { increment: kobo } },
    create: { userId, asset: Asset.NGN, available: kobo },
  });
}

// ------------------------------------------------------------------ create --

export async function createPlan(
  userId: string,
  input: { name: string; amountKobo: bigint; frequency: Frequency; count: number },
): Promise<PlanRow> {
  await ensureAjoSchema();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycTier: true } });
  if (!user || user.kycTier < PLAN_MIN_TIER) {
    throw new ApiError(403, "Verify your identity to start an Ajo plan.", "kyc_required");
  }
  const problem = planProblem(input, getTierLimits(user.kycTier).singleTxKobo);
  if (problem) throw new ApiError(422, problem, "ajo_invalid");
  await assertNoAjoArrears(userId);

  const now = new Date();
  const plan = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRaw<PlanRow[]>`
      INSERT INTO ajo_plans (user_id, name, amount_minor, frequency, total_count, paid_count, saved_minor, next_due_at)
      VALUES (${userId}::uuid, ${input.name}, ${input.amountKobo}, ${input.frequency}, ${input.count}, 1,
        ${input.amountKobo}, ${nextDueAfter(now, input.frequency)})
      RETURNING *`;
    const p = rows[0];
    // The first contribution is taken now: no money, no plan.
    if (!(await debitNgn(db, userId, input.amountKobo))) {
      throw new ApiError(422, `Add at least ${naira(input.amountKobo)} to your wallet to make the first contribution.`, "insufficient_funds");
    }
    await db.transaction.create({
      data: {
        userId,
        type: TransactionType.AJO_SAVE,
        asset: Asset.NGN,
        amount: input.amountKobo,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: `ajo:p:${p.id}:1`,
        metadata: { kind: "ajo_plan", planId: p.id, planName: input.name, contribution: 1, of: input.count },
      },
    });
    return p;
  });
  return plan;
}

// ------------------------------------------------------------- scheduled --

type PlanOutcome = { plan: PlanRow; paid: boolean; matured: bigint | null };

/** Take one due contribution from one plan (and pay out if it was the last). */
async function processOneDuePlan(): Promise<PlanOutcome | null> {
  return prisma.$transaction(
    async (db) => {
      const rows = await db.$queryRaw<PlanRow[]>`
        SELECT * FROM ajo_plans WHERE status = 'active' AND next_due_at <= now()
        ORDER BY next_due_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const p = rows[0];
      if (!p) return null;
      const n = p.paid_count + p.missed_count + 1;
      // A member who owes their Ajo group pays the group first: their wallet
      // money is held for the arrears sweep, so this contribution is skipped.
      const owesGroup = (await ajoArrearsKobo(p.user_id, db)) > 0n;
      const paid = !owesGroup && (await debitNgn(db, p.user_id, p.amount_minor));
      let saved = p.saved_minor;
      if (paid) {
        saved += p.amount_minor;
        await db.transaction.create({
          data: {
            userId: p.user_id,
            type: TransactionType.AJO_SAVE,
            asset: Asset.NGN,
            amount: p.amount_minor,
            status: TransactionStatus.COMPLETED,
            idempotencyKey: `ajo:p:${p.id}:${n}`,
            metadata: { kind: "ajo_plan", planId: p.id, planName: p.name, contribution: n, of: p.total_count },
          },
        });
      }
      if (n >= p.total_count) {
        // Last contribution: everything saved goes back to the wallet, free.
        await creditNgn(db, p.user_id, saved);
        if (saved > 0n) {
          await db.transaction.create({
            data: {
              userId: p.user_id,
              type: TransactionType.AJO_RELEASE,
              asset: Asset.NGN,
              amount: saved,
              fee: 0n,
              status: TransactionStatus.COMPLETED,
              idempotencyKey: `ajo:p:${p.id}:release`,
              metadata: { kind: "ajo_plan", planId: p.id, planName: p.name, reason: "matured" },
            },
          });
        }
        await db.$executeRaw`
          UPDATE ajo_plans SET status = 'matured', saved_minor = 0,
            paid_count = paid_count + ${paid ? 1 : 0}, missed_count = missed_count + ${paid ? 0 : 1},
            next_due_at = NULL, closed_at = now(), updated_at = now()
          WHERE id = ${p.id}::uuid`;
        return { plan: p, paid, matured: saved };
      }
      await db.$executeRaw`
        UPDATE ajo_plans SET saved_minor = ${saved},
          paid_count = paid_count + ${paid ? 1 : 0}, missed_count = missed_count + ${paid ? 0 : 1},
          next_due_at = ${nextDueAfter(p.next_due_at ?? new Date(), p.frequency)}, updated_at = now()
        WHERE id = ${p.id}::uuid`;
      return { plan: p, paid, matured: null };
    },
    { timeout: 20_000 },
  );
}

export async function runDuePlans(opts: { deadline: number; limit?: number }): Promise<{ processed: number; missed: number; matured: number }> {
  const out = { processed: 0, missed: 0, matured: 0 };
  while (Date.now() < opts.deadline && out.processed < (opts.limit ?? 500)) {
    const r = await processOneDuePlan();
    if (!r) break;
    out.processed++;
    if (!r.paid) {
      out.missed++;
      await notifyUser(r.plan.user_id, {
        category: "withdrawals",
        title: "Ajo contribution missed",
        body: `We couldn't take ${naira(r.plan.amount_minor)} for "${r.plan.name}" because your wallet was short. We'll try again on the next due date.`,
        data: { ajoPlanId: r.plan.id },
      }).catch(() => undefined);
    }
    if (r.matured !== null) {
      out.matured++;
      await notifyUser(r.plan.user_id, {
        category: "deposits",
        title: "Your Ajo plan is complete",
        body: r.matured > 0n
          ? `${naira(r.matured)} from "${r.plan.name}" is back in your wallet.`
          : `"${r.plan.name}" has ended.`,
        data: { ajoPlanId: r.plan.id },
      }).catch(() => undefined);
    }
  }
  return out;
}

// ------------------------------------------------------------------ break --

export async function breakPlan(userId: string, planId: string): Promise<{ returnedKobo: bigint; feeKobo: bigint }> {
  await ensureAjoSchema();
  const bps = await getAjoBreakFeeBps();
  return prisma.$transaction(async (db) => {
    const rows = await db.$queryRaw<PlanRow[]>`
      SELECT * FROM ajo_plans WHERE id = ${planId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
    const p = rows[0];
    if (!p) throw new ApiError(404, "Plan not found", "not_found");
    if (p.status !== "active") throw new ApiError(409, "This plan has already ended.", "ajo_closed");
    const fee = breakFee(p.saved_minor, bps);
    const back = p.saved_minor - fee;
    await creditNgn(db, userId, back);
    if (p.saved_minor > 0n) {
      await db.transaction.create({
        data: {
          userId,
          type: TransactionType.AJO_RELEASE,
          asset: Asset.NGN,
          amount: p.saved_minor,
          fee,
          status: TransactionStatus.COMPLETED,
          idempotencyKey: `ajo:p:${p.id}:release`,
          metadata: { kind: "ajo_plan", planId: p.id, planName: p.name, reason: "broken", feeBps: bps },
        },
      });
    }
    await db.$executeRaw`
      UPDATE ajo_plans SET status = 'broken', saved_minor = 0, next_due_at = NULL, closed_at = now(), updated_at = now()
      WHERE id = ${p.id}::uuid`;
    return { returnedKobo: back, feeKobo: fee };
  });
}

export async function listPlans(userId: string): Promise<PlanRow[]> {
  await ensureAjoSchema();
  return prisma.$queryRaw<PlanRow[]>`
    SELECT * FROM ajo_plans WHERE user_id = ${userId}::uuid
    ORDER BY (status = 'active') DESC, created_at DESC LIMIT 50`;
}
