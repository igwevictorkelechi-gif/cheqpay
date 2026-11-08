// apps/api/src/lib/ajo/groups.ts
//
// Group Ajo (rotating savings). Everyone pays the same amount each round;
// each round one member collects the pot. Lifecycle:
//
//   forming   the organiser creates it and shares an invite code; members
//             join with their PIN (Tier 2+), which authorises the auto-debits
//   active    the organiser starts it: collecting positions are fixed (join
//             order or random) and round 1 is due at the next 9am Lagos time
//             at least 12 hours away; each round:
//               - every member's contribution is auto-debited from their wallet
//                 (the collector's own share simply stays in their wallet)
//               - the collector receives what was collected, at once
//               - a member who is short is marked in arrears for that round
//   completed after the last round. Arrears still owed keep being collected.
//
// The lien (lien.ts): while a member owes anything, money coming into their
// wallet is swept to the collectors they owe (oldest first), and money-out
// routes refuse. CheqPay never pays a missed contribution itself.
//
// Every money move is inside one database transaction with a balance guard and
// a fixed idempotency key; a round is processed under a row lock, so it runs
// exactly once even when the scheduler overlaps.

import { Asset, Prisma, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { ApiError } from "@/lib/http";
import { formatNairaMinor } from "@/lib/money";
import { getTierLimits } from "@/lib/kyc";
import { lockUserMoney } from "@/lib/limits";
import { notifyUser } from "@/lib/alerts";
import { ensureAjoSchema } from "./schema";
import { assertNoAjoArrears } from "./lien";
import {
  DUE_HOUR_UTC,
  GROUP_MIN_TIER,
  allocateArrears,
  groupProblem,
  inviteCode,
  nextDueAfter,
  normaliseInviteCode,
  payoutOrder,
  type Frequency,
} from "./rules";

type Tx = Prisma.TransactionClient;

export interface GroupRow {
  id: string;
  owner_id: string;
  name: string;
  amount_minor: bigint;
  frequency: Frequency;
  size: number;
  payout_order: "join" | "random";
  invite_code: string;
  status: "forming" | "active" | "completed" | "cancelled";
  current_round: number;
  next_due_at: Date | null;
  started_at: Date | null;
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

async function requireGroupMemberEligible(userId: string, amountKobo: bigint): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycTier: true, status: true } });
  if (!user || user.status !== "ACTIVE") throw new ApiError(403, "Your account can't join an Ajo group.", "account_inactive");
  if (user.kycTier < GROUP_MIN_TIER) {
    throw new ApiError(403, "Group Ajo needs a verified government ID (Tier 2). Upgrade your verification to join.", "kyc_required");
  }
  if (amountKobo > getTierLimits(user.kycTier).singleTxKobo) {
    throw new ApiError(422, "This group's contribution is above your per-transaction limit.", "single_tx_limit");
  }
  await assertNoAjoArrears(userId);
}

/** First due time: 9am Lagos (08:00 UTC) at least 12 hours from now, so members get notice. */
export function firstDueAt(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DUE_HOUR_UTC));
  while (d.getTime() < now.getTime() + 12 * 3600_000) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// ----------------------------------------------------------- forming stage --

export async function createGroup(
  ownerId: string,
  input: { name: string; amountKobo: bigint; frequency: Frequency; size: number; order: "join" | "random" },
): Promise<GroupRow> {
  await ensureAjoSchema();
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { kycTier: true } });
  const problem = groupProblem(input, getTierLimits(owner?.kycTier ?? 0).singleTxKobo);
  if (problem) throw new ApiError(422, problem, "ajo_invalid");
  await requireGroupMemberEligible(ownerId, input.amountKobo);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async (db) => {
        const rows = await db.$queryRaw<GroupRow[]>`
          INSERT INTO ajo_groups (owner_id, name, amount_minor, frequency, size, payout_order, invite_code)
          VALUES (${ownerId}::uuid, ${input.name}, ${input.amountKobo}, ${input.frequency}, ${input.size},
            ${input.order}, ${inviteCode()})
          RETURNING *`;
        await db.$executeRaw`INSERT INTO ajo_members (group_id, user_id) VALUES (${rows[0].id}::uuid, ${ownerId}::uuid)`;
        return rows[0];
      });
    } catch (err) {
      // A clash on the random invite code: try another.
      if (/ajo_groups_invite_key/.test(String((err as Error)?.message))) continue;
      throw err;
    }
  }
  throw new ApiError(503, "Couldn't create the group. Please try again.", "ajo_retry");
}

export async function joinGroup(userId: string, rawCode: string): Promise<GroupRow> {
  await ensureAjoSchema();
  const code = normaliseInviteCode(rawCode);
  const found = await prisma.$queryRaw<GroupRow[]>`SELECT * FROM ajo_groups WHERE invite_code = ${code}`;
  if (!found[0]) throw new ApiError(404, "No Ajo group has that invite code.", "not_found");
  await requireGroupMemberEligible(userId, found[0].amount_minor);

  const { group, full } = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRaw<GroupRow[]>`SELECT * FROM ajo_groups WHERE id = ${found[0].id}::uuid FOR UPDATE`;
    const g = rows[0];
    if (g.status !== "forming") throw new ApiError(409, "This group has already started or closed.", "ajo_closed");
    const count = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM ajo_members WHERE group_id = ${g.id}::uuid`;
    if (Number(count[0].n) >= g.size) throw new ApiError(409, "This group is full.", "ajo_full");
    const inserted = await db.$executeRaw`
      INSERT INTO ajo_members (group_id, user_id) VALUES (${g.id}::uuid, ${userId}::uuid) ON CONFLICT DO NOTHING`;
    if (inserted !== 1) throw new ApiError(409, "You're already in this group.", "ajo_member");
    return { group: g, full: Number(count[0].n) + 1 >= g.size };
  });
  if (full) {
    await notifyUser(group.owner_id, {
      category: "updates",
      title: "Your Ajo group is full",
      body: `"${group.name}" has all ${group.size} members. Start it when you're ready.`,
      data: { ajoGroupId: group.id },
    }).catch(() => undefined);
  }
  return group;
}

export async function leaveGroup(userId: string, groupId: string): Promise<void> {
  await ensureAjoSchema();
  await prisma.$transaction(async (db) => {
    const rows = await db.$queryRaw<GroupRow[]>`SELECT * FROM ajo_groups WHERE id = ${groupId}::uuid FOR UPDATE`;
    const g = rows[0];
    if (!g) throw new ApiError(404, "Group not found", "not_found");
    if (g.owner_id === userId) throw new ApiError(409, "As the organiser, cancel the group instead.", "ajo_owner");
    if (g.status !== "forming") throw new ApiError(409, "You can't leave a group once it has started.", "ajo_started");
    await db.$executeRaw`DELETE FROM ajo_members WHERE group_id = ${groupId}::uuid AND user_id = ${userId}::uuid`;
  });
}

export async function cancelGroup(userId: string, groupId: string): Promise<void> {
  await ensureAjoSchema();
  const n = await prisma.$executeRaw`
    UPDATE ajo_groups SET status = 'cancelled', closed_at = now(), updated_at = now()
    WHERE id = ${groupId}::uuid AND owner_id = ${userId}::uuid AND status = 'forming'`;
  if (n !== 1) throw new ApiError(409, "Only the organiser can cancel a group, and only before it starts.", "ajo_cancel");
}

export async function startGroup(userId: string, groupId: string): Promise<GroupRow> {
  await ensureAjoSchema();
  const g = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRaw<GroupRow[]>`SELECT * FROM ajo_groups WHERE id = ${groupId}::uuid FOR UPDATE`;
    const g = rows[0];
    if (!g || g.owner_id !== userId) throw new ApiError(404, "Group not found", "not_found");
    if (g.status !== "forming") throw new ApiError(409, "This group has already started or closed.", "ajo_closed");
    const members = await db.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM ajo_members WHERE group_id = ${g.id}::uuid ORDER BY joined_at, id`;
    if (members.length < 2) throw new ApiError(409, "A group needs at least 2 members to start.", "ajo_too_small");
    const order = payoutOrder(members.map((m) => m.user_id), g.payout_order);
    for (const [i, uid] of order.entries()) {
      await db.$executeRaw`
        UPDATE ajo_members SET position = ${i + 1} WHERE group_id = ${g.id}::uuid AND user_id = ${uid}::uuid`;
    }
    const due = firstDueAt();
    const out = await db.$queryRaw<GroupRow[]>`
      UPDATE ajo_groups SET status = 'active', size = ${order.length}, current_round = 1, started_at = now(),
        next_due_at = ${due}, updated_at = now()
      WHERE id = ${g.id}::uuid RETURNING *`;
    return out[0];
  });
  const members = await prisma.$queryRaw<{ user_id: string; position: number }[]>`
    SELECT user_id, position FROM ajo_members WHERE group_id = ${g.id}::uuid`;
  await Promise.all(
    members.map((m) =>
      notifyUser(m.user_id, {
        category: "updates",
        title: `"${g.name}" has started`,
        body: `You collect in round ${m.position} of ${g.size}. The first ${naira(g.amount_minor)} contribution is taken from your wallet at 9am on ${g.next_due_at?.toISOString().slice(0, 10)}.`,
        data: { ajoGroupId: g.id },
      }).catch(() => undefined),
    ),
  );
  return g;
}

// ------------------------------------------------------------- round runs --

interface RoundOutcome {
  group: GroupRow;
  round: number;
  recipientId: string;
  receivedKobo: bigint;
  paid: string[];
  missed: string[];
}

/** Run one due round of one group: debit everyone, pay the collector. */
async function processOneDueRound(groupId?: string): Promise<RoundOutcome | null> {
  return prisma.$transaction(
    async (db) => {
      const rows = await db.$queryRaw<GroupRow[]>`
        SELECT * FROM ajo_groups
        WHERE status = 'active' AND next_due_at <= now()
          AND (${groupId ?? null}::uuid IS NULL OR id = ${groupId ?? null}::uuid)
        ORDER BY next_due_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const g = rows[0];
      if (!g) return null;
      const r = g.current_round;
      // Locked in a fixed order (by user id) to avoid deadlocks between groups.
      const members = await db.$queryRaw<{ user_id: string; position: number }[]>`
        SELECT user_id, position FROM ajo_members WHERE group_id = ${g.id}::uuid ORDER BY user_id`;
      const recipient = members.find((m) => m.position === r);
      if (!recipient) throw new Error(`ajo group ${g.id} has no member at position ${r}`);

      const paid: string[] = [];
      const missed: string[] = [];
      let collected = 0n;
      for (const m of members) {
        const exists = await db.$queryRaw<{ id: string }[]>`
          SELECT id FROM ajo_contributions WHERE group_id = ${g.id}::uuid AND round = ${r} AND user_id = ${m.user_id}::uuid`;
        if (exists[0]) continue; // already handled (never happens under the row lock; belt and braces)
        if (m.user_id === recipient.user_id) {
          // The collector's own share never leaves their wallet.
          await db.$executeRaw`
            INSERT INTO ajo_contributions (group_id, round, user_id, recipient_id, amount_minor, paid_minor, status, paid_at)
            VALUES (${g.id}::uuid, ${r}, ${m.user_id}::uuid, ${recipient.user_id}::uuid, ${g.amount_minor}, ${g.amount_minor}, 'paid', now())`;
          continue;
        }
        if (await debitNgn(db, m.user_id, g.amount_minor)) {
          collected += g.amount_minor;
          paid.push(m.user_id);
          await db.$executeRaw`
            INSERT INTO ajo_contributions (group_id, round, user_id, recipient_id, amount_minor, paid_minor, status, paid_at)
            VALUES (${g.id}::uuid, ${r}, ${m.user_id}::uuid, ${recipient.user_id}::uuid, ${g.amount_minor}, ${g.amount_minor}, 'paid', now())`;
          await db.transaction.create({
            data: {
              userId: m.user_id,
              type: TransactionType.AJO_CONTRIBUTION,
              asset: Asset.NGN,
              amount: g.amount_minor,
              status: TransactionStatus.COMPLETED,
              idempotencyKey: `ajo:g:${g.id}:${r}:${m.user_id}`,
              metadata: { kind: "ajo_group", groupId: g.id, groupName: g.name, round: r, recipientId: recipient.user_id },
            },
          });
        } else {
          missed.push(m.user_id);
          await db.$executeRaw`
            INSERT INTO ajo_contributions (group_id, round, user_id, recipient_id, amount_minor, paid_minor, status)
            VALUES (${g.id}::uuid, ${r}, ${m.user_id}::uuid, ${recipient.user_id}::uuid, ${g.amount_minor}, 0, 'missed')`;
        }
      }

      await creditNgn(db, recipient.user_id, collected);
      if (collected > 0n) {
        await db.transaction.create({
          data: {
            userId: recipient.user_id,
            type: TransactionType.AJO_PAYOUT,
            asset: Asset.NGN,
            amount: collected,
            status: TransactionStatus.COMPLETED,
            idempotencyKey: `ajo:gp:${g.id}:${r}`,
            metadata: { kind: "ajo_group", groupId: g.id, groupName: g.name, round: r, from: paid.length },
          },
        });
      }
      await db.$executeRaw`
        INSERT INTO ajo_payouts (group_id, round, recipient_id, amount_minor)
        VALUES (${g.id}::uuid, ${r}, ${recipient.user_id}::uuid, ${collected + g.amount_minor})
        ON CONFLICT (group_id, round) DO NOTHING`;

      if (r >= g.size) {
        await db.$executeRaw`
          UPDATE ajo_groups SET status = 'completed', next_due_at = NULL, closed_at = now(), updated_at = now()
          WHERE id = ${g.id}::uuid`;
      } else {
        await db.$executeRaw`
          UPDATE ajo_groups SET current_round = ${r + 1},
            next_due_at = ${nextDueAfter(g.next_due_at ?? new Date(), g.frequency)}, updated_at = now()
          WHERE id = ${g.id}::uuid`;
      }
      return { group: g, round: r, recipientId: recipient.user_id, receivedKobo: collected, paid, missed };
    },
    { timeout: 30_000 },
  );
}

export async function runDueRounds(opts: { deadline: number; groupId?: string }): Promise<{ rounds: number; missed: number }> {
  const out = { rounds: 0, missed: 0 };
  while (Date.now() < opts.deadline) {
    const r = await processOneDueRound(opts.groupId);
    if (!r) break;
    out.rounds++;
    out.missed += r.missed.length;
    const g = r.group;
    const pot = g.amount_minor * BigInt(g.size);
    await notifyUser(r.recipientId, {
      category: "deposits",
      title: `It's your turn: ${g.name}`,
      body: r.missed.length === 0
        ? `You collected the ${naira(pot)} pot for round ${r.round}. ${naira(r.receivedKobo)} from the group is in your wallet, and your own ${naira(g.amount_minor)} share stayed there.`
        : `${naira(r.receivedKobo)} from the group is in your wallet for round ${r.round}. ${r.missed.length} member(s) are behind; their share comes to you as soon as they pay.`,
      data: { ajoGroupId: g.id },
    }).catch(() => undefined);
    await Promise.all(
      r.missed.map((uid) =>
        notifyUser(uid, {
          category: "withdrawals",
          title: "Ajo contribution missed",
          body: `Your ${naira(g.amount_minor)} for "${g.name}" round ${r.round} couldn't be taken. Add money to your wallet: it goes to your group first, and withdrawals and transfers are paused until you're caught up.`,
          data: { ajoGroupId: g.id },
        }).catch(() => undefined),
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------- arrears sweep --

/** Collect what members owe from whatever is in their wallets, oldest round first. */
export async function sweepArrears(opts: { deadline: number; userId?: string }): Promise<{ users: number; settledKobo: bigint }> {
  await ensureAjoSchema();
  const debtors = await prisma.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT c.user_id FROM ajo_contributions c
    JOIN balances b ON b.user_id = c.user_id AND b.asset = 'NGN' AND b.available > 0
    WHERE c.status <> 'paid' AND (${opts.userId ?? null}::uuid IS NULL OR c.user_id = ${opts.userId ?? null}::uuid)
    LIMIT 200`;
  const out = { users: 0, settledKobo: 0n };
  for (const { user_id } of debtors) {
    if (Date.now() >= opts.deadline) break;
    const settled = await prisma.$transaction(
      async (db) => {
        await lockUserMoney(db, user_id);
        const bal = await db.balance.findUnique({ where: { userId_asset: { userId: user_id, asset: Asset.NGN } } });
        const owed = await db.$queryRaw<
          { id: string; group_id: string; round: number; recipient_id: string; amount_minor: bigint; paid_minor: bigint; name: string }[]
        >`
          SELECT c.id, c.group_id, c.round, c.recipient_id, c.amount_minor, c.paid_minor, g.name
          FROM ajo_contributions c JOIN ajo_groups g ON g.id = c.group_id
          WHERE c.user_id = ${user_id}::uuid AND c.status <> 'paid'
          ORDER BY c.created_at, c.round FOR UPDATE OF c`;
        const plan = allocateArrears(
          bal?.available ?? 0n,
          owed.map((o) => ({ id: o.id, owedKobo: o.amount_minor - o.paid_minor })),
        );
        let total = 0n;
        for (const { id, payKobo } of plan) {
          const o = owed.find((x) => x.id === id)!;
          if (!(await debitNgn(db, user_id, payKobo))) break;
          const paidAfter = o.paid_minor + payKobo;
          await db.$executeRaw`
            UPDATE ajo_contributions SET paid_minor = ${paidAfter},
              status = ${paidAfter >= o.amount_minor ? "paid" : "partial"},
              paid_at = ${paidAfter >= o.amount_minor ? new Date() : null}
            WHERE id = ${o.id}::uuid`;
          await creditNgn(db, o.recipient_id, payKobo);
          await db.$executeRaw`
            UPDATE ajo_payouts SET amount_minor = amount_minor + ${payKobo}, updated_at = now()
            WHERE group_id = ${o.group_id}::uuid AND round = ${o.round}`;
          const meta = { kind: "ajo_group", groupId: o.group_id, groupName: o.name, round: o.round, late: true };
          await db.transaction.create({
            data: {
              userId: user_id,
              type: TransactionType.AJO_CONTRIBUTION,
              asset: Asset.NGN,
              amount: payKobo,
              status: TransactionStatus.COMPLETED,
              idempotencyKey: `ajo:gl:${o.id}:${o.paid_minor}`,
              metadata: { ...meta, recipientId: o.recipient_id },
            },
          });
          await db.transaction.create({
            data: {
              userId: o.recipient_id,
              type: TransactionType.AJO_PAYOUT,
              asset: Asset.NGN,
              amount: payKobo,
              status: TransactionStatus.COMPLETED,
              idempotencyKey: `ajo:glp:${o.id}:${o.paid_minor}`,
              metadata: { ...meta, fromUserId: user_id },
            },
          });
          total += payKobo;
        }
        return total;
      },
      { timeout: 20_000 },
    );
    if (settled > 0n) {
      out.users++;
      out.settledKobo += settled;
      await notifyUser(user_id, {
        category: "withdrawals",
        title: "Ajo arrears paid",
        body: `${naira(settled)} from your wallet went to your Ajo group to cover what you owed.`,
        data: {},
      }).catch(() => undefined);
    }
  }
  return out;
}

// ------------------------------------------------------------------ views --

export async function listMyGroups(userId: string) {
  await ensureAjoSchema();
  return prisma.$queryRaw<(GroupRow & { position: number | null; members: number })[]>`
    SELECT g.*, m.position,
      (SELECT count(*)::int FROM ajo_members x WHERE x.group_id = g.id) AS members
    FROM ajo_groups g JOIN ajo_members m ON m.group_id = g.id AND m.user_id = ${userId}::uuid
    ORDER BY (g.status IN ('forming', 'active')) DESC, g.created_at DESC LIMIT 50`;
}

export async function groupDetail(userId: string, groupId: string) {
  await ensureAjoSchema();
  const rows = await prisma.$queryRaw<GroupRow[]>`
    SELECT g.* FROM ajo_groups g JOIN ajo_members m ON m.group_id = g.id
    WHERE g.id = ${groupId}::uuid AND m.user_id = ${userId}::uuid`;
  const g = rows[0];
  if (!g) throw new ApiError(404, "Group not found", "not_found");
  const members = await prisma.$queryRaw<
    { user_id: string; username: string | null; position: number | null; joined_at: Date; owed: bigint }[]
  >`
    SELECT m.user_id, u.username, m.position, m.joined_at,
      COALESCE((SELECT SUM(c.amount_minor - c.paid_minor) FROM ajo_contributions c
        WHERE c.group_id = m.group_id AND c.user_id = m.user_id AND c.status <> 'paid'), 0)::bigint AS owed
    FROM ajo_members m JOIN app_users u ON u.id = m.user_id
    WHERE m.group_id = ${g.id}::uuid ORDER BY m.position NULLS LAST, m.joined_at`;
  const payouts = await prisma.$queryRaw<{ round: number; recipient_id: string; amount_minor: bigint; created_at: Date }[]>`
    SELECT round, recipient_id, amount_minor, created_at FROM ajo_payouts WHERE group_id = ${g.id}::uuid ORDER BY round`;
  return { group: g, members, payouts };
}
