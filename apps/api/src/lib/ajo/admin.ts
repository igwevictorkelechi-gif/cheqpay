// apps/api/src/lib/ajo/admin.ts
//
// What ops sees of Ajo: how much is in plans, which groups are running, who
// owes whom and for how long. Read-only: the engine moves the money, and the
// lien collects arrears; admins watch, and reach the user through support.

import { Asset, prisma } from "@cheqpay/db";
import { ApiError } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";
import { ensureAjoSchema } from "./schema";

const ngn = (k: bigint | number | null | undefined) => fromMinorUnits(BigInt(k ?? 0), Asset.NGN);

export async function ajoAdminOverview() {
  await ensureAjoSchema();
  const [plans, groups, arrears, dueToday] = await Promise.all([
    prisma.$queryRaw<{ status: string; n: number; saved: bigint | null }[]>`
      SELECT status, count(*)::int AS n, COALESCE(SUM(saved_minor), 0)::bigint AS saved FROM ajo_plans GROUP BY status`,
    prisma.$queryRaw<{ status: string; n: number; pot: bigint | null }[]>`
      SELECT status, count(*)::int AS n, COALESCE(SUM(amount_minor * size), 0)::bigint AS pot FROM ajo_groups GROUP BY status`,
    prisma.$queryRaw<{ debtors: number; owed: bigint | null; oldest: Date | null }[]>`
      SELECT count(DISTINCT user_id)::int AS debtors, COALESCE(SUM(amount_minor - paid_minor), 0)::bigint AS owed, MIN(created_at) AS oldest
      FROM ajo_contributions WHERE status <> 'paid'`,
    prisma.$queryRaw<{ plans: number; groups: number }[]>`
      SELECT (SELECT count(*) FROM ajo_plans WHERE status = 'active' AND next_due_at < now() + interval '24 hours')::int AS plans,
             (SELECT count(*) FROM ajo_groups WHERE status = 'active' AND next_due_at < now() + interval '24 hours')::int AS groups`,
  ]);
  const by = <T extends { status: string }>(rows: T[], s: string) => rows.find((r) => r.status === s);
  return {
    plans: {
      active: by(plans, "active")?.n ?? 0,
      matured: by(plans, "matured")?.n ?? 0,
      broken: by(plans, "broken")?.n ?? 0,
      /** Naira currently locked in active plans: owed to customers, counted by the treasury check. */
      savedNgn: ngn(by(plans, "active")?.saved),
    },
    groups: {
      forming: by(groups, "forming")?.n ?? 0,
      active: by(groups, "active")?.n ?? 0,
      completed: by(groups, "completed")?.n ?? 0,
      cancelled: by(groups, "cancelled")?.n ?? 0,
      /** Sum of the pots of running groups: what changes hands per full cycle. */
      activePotNgn: ngn(by(groups, "active")?.pot),
    },
    arrears: {
      debtors: arrears[0]?.debtors ?? 0,
      owedNgn: ngn(arrears[0]?.owed),
      oldestSince: arrears[0]?.oldest ?? null,
    },
    dueNext24h: { plans: dueToday[0]?.plans ?? 0, groups: dueToday[0]?.groups ?? 0 },
  };
}

export type GroupFilter = "active" | "forming" | "completed" | "cancelled" | "arrears" | "all";

export async function listAjoGroupsAdmin(filter: GroupFilter = "active") {
  await ensureAjoSchema();
  const rows = await prisma.$queryRaw<
    {
      id: string; name: string; status: string; frequency: string; amount_minor: bigint; size: number; payout_order: string;
      current_round: number; next_due_at: Date | null; started_at: Date | null; created_at: Date;
      owner_email: string | null; owner_username: string | null; members: number; owed: bigint | null; behind: number;
    }[]
  >`
    SELECT g.id, g.name, g.status, g.frequency, g.amount_minor, g.size, g.payout_order, g.current_round,
           g.next_due_at, g.started_at, g.created_at, u.email AS owner_email, u.username AS owner_username,
           (SELECT count(*)::int FROM ajo_members m WHERE m.group_id = g.id) AS members,
           COALESCE((SELECT SUM(c.amount_minor - c.paid_minor) FROM ajo_contributions c WHERE c.group_id = g.id AND c.status <> 'paid'), 0)::bigint AS owed,
           (SELECT count(DISTINCT c.user_id)::int FROM ajo_contributions c WHERE c.group_id = g.id AND c.status <> 'paid') AS behind
    FROM ajo_groups g JOIN app_users u ON u.id = g.owner_id
    WHERE CASE ${filter}
      WHEN 'all' THEN true
      WHEN 'arrears' THEN EXISTS (SELECT 1 FROM ajo_contributions c WHERE c.group_id = g.id AND c.status <> 'paid')
      ELSE g.status = ${filter} END
    ORDER BY (g.status = 'active') DESC, g.next_due_at NULLS LAST, g.created_at DESC
    LIMIT 200`;
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    status: g.status,
    frequency: g.frequency,
    amount: ngn(g.amount_minor),
    pot: ngn(g.amount_minor * BigInt(g.size)),
    size: g.size,
    members: g.members,
    payoutOrder: g.payout_order,
    currentRound: g.current_round,
    nextDueAt: g.next_due_at,
    startedAt: g.started_at,
    createdAt: g.created_at,
    owner: { email: g.owner_email, username: g.owner_username },
    owed: ngn(g.owed),
    behind: g.behind,
  }));
}

export async function ajoGroupAdminDetail(id: string) {
  await ensureAjoSchema();
  const groups = await listAjoGroupsAdmin("all").then((all) => all.filter((g) => g.id === id));
  const group = groups[0];
  if (!group) throw new ApiError(404, "Group not found", "not_found");
  const [members, rounds] = await Promise.all([
    prisma.$queryRaw<
      { user_id: string; email: string; username: string | null; kyc_tier: number; position: number | null; joined_at: Date; owed: bigint | null; missed: number; paid: number }[]
    >`
      SELECT m.user_id, u.email, u.username, u.kyc_tier, m.position, m.joined_at,
        COALESCE((SELECT SUM(c.amount_minor - c.paid_minor) FROM ajo_contributions c WHERE c.group_id = m.group_id AND c.user_id = m.user_id AND c.status <> 'paid'), 0)::bigint AS owed,
        (SELECT count(*)::int FROM ajo_contributions c WHERE c.group_id = m.group_id AND c.user_id = m.user_id AND c.status <> 'paid') AS missed,
        (SELECT count(*)::int FROM ajo_contributions c WHERE c.group_id = m.group_id AND c.user_id = m.user_id AND c.status = 'paid') AS paid
      FROM ajo_members m JOIN app_users u ON u.id = m.user_id
      WHERE m.group_id = ${id}::uuid ORDER BY m.position NULLS LAST, m.joined_at`,
    prisma.$queryRaw<{ round: number; recipient: string | null; collected: bigint; paid: number; short: number; at: Date }[]>`
      SELECT p.round, u.username AS recipient, p.amount_minor AS collected,
        (SELECT count(*)::int FROM ajo_contributions c WHERE c.group_id = p.group_id AND c.round = p.round AND c.status = 'paid') AS paid,
        (SELECT count(*)::int FROM ajo_contributions c WHERE c.group_id = p.group_id AND c.round = p.round AND c.status <> 'paid') AS short,
        p.created_at AS at
      FROM ajo_payouts p JOIN app_users u ON u.id = p.recipient_id
      WHERE p.group_id = ${id}::uuid ORDER BY p.round`,
  ]);
  return {
    group,
    members: members.map((m) => ({
      userId: m.user_id,
      email: m.email,
      username: m.username,
      kycTier: m.kyc_tier,
      position: m.position,
      joinedAt: m.joined_at,
      owed: ngn(m.owed),
      missedRounds: m.missed,
      paidRounds: m.paid,
    })),
    rounds: rounds.map((r) => ({ round: r.round, recipient: r.recipient, collected: ngn(r.collected), paid: r.paid, short: r.short, at: r.at })),
  };
}

/** Everyone who owes a group, worst first, with how long it has been outstanding. */
export async function listAjoDebtorsAdmin() {
  await ensureAjoSchema();
  const rows = await prisma.$queryRaw<
    { user_id: string; email: string; username: string | null; status: string; owed: bigint; rounds: number; since: Date; groups: string[]; balance: bigint | null }[]
  >`
    SELECT c.user_id, u.email, u.username, u.status::text AS status,
           SUM(c.amount_minor - c.paid_minor)::bigint AS owed, count(*)::int AS rounds, MIN(c.created_at) AS since,
           array_agg(DISTINCT g.name) AS groups,
           (SELECT b.available FROM balances b WHERE b.user_id = c.user_id AND b.asset = 'NGN') AS balance
    FROM ajo_contributions c JOIN app_users u ON u.id = c.user_id JOIN ajo_groups g ON g.id = c.group_id
    WHERE c.status <> 'paid'
    GROUP BY c.user_id, u.email, u.username, u.status
    ORDER BY owed DESC LIMIT 200`;
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    username: r.username,
    accountStatus: r.status,
    owed: ngn(r.owed),
    rounds: r.rounds,
    since: r.since,
    groups: r.groups,
    /** Naira in their wallet right now; anything here is swept within a minute. */
    walletNgn: ngn(r.balance),
  }));
}

export async function listAjoPlansAdmin(status: "active" | "matured" | "broken" | "all" = "active") {
  await ensureAjoSchema();
  const rows = await prisma.$queryRaw<
    { id: string; name: string; status: string; frequency: string; amount_minor: bigint; total_count: number; paid_count: number; missed_count: number; saved_minor: bigint; next_due_at: Date | null; created_at: Date; closed_at: Date | null; email: string; username: string | null }[]
  >`
    SELECT p.id, p.name, p.status, p.frequency, p.amount_minor, p.total_count, p.paid_count, p.missed_count, p.saved_minor,
           p.next_due_at, p.created_at, p.closed_at, u.email, u.username
    FROM ajo_plans p JOIN app_users u ON u.id = p.user_id
    WHERE ${status} = 'all' OR p.status = ${status}
    ORDER BY p.created_at DESC LIMIT 200`;
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    frequency: p.frequency,
    amount: ngn(p.amount_minor),
    saved: ngn(p.saved_minor),
    target: ngn(p.amount_minor * BigInt(p.total_count)),
    totalCount: p.total_count,
    paidCount: p.paid_count,
    missedCount: p.missed_count,
    nextDueAt: p.next_due_at,
    createdAt: p.created_at,
    closedAt: p.closed_at,
    user: { email: p.email, username: p.username },
  }));
}
