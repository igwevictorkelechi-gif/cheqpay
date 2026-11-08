// apps/api/src/lib/ajo/view.ts
//
// JSON shapes for the apps. Amounts go out as naira strings ("5000.00"), the
// same as the rest of the API, because bigints don't serialise. Other members'
// user ids are not exposed: the apps see usernames and positions only.

import { Asset } from "@cheqpay/db";
import { fromMinorUnits } from "@/lib/money";
import type { PlanRow } from "./personal";
import type { GroupRow } from "./groups";

const ngn = (k: bigint | number | null | undefined) => fromMinorUnits(BigInt(k ?? 0), Asset.NGN);

export function planView(p: PlanRow) {
  return {
    id: p.id,
    name: p.name,
    amount: ngn(p.amount_minor),
    frequency: p.frequency,
    totalCount: p.total_count,
    paidCount: p.paid_count,
    missedCount: p.missed_count,
    saved: ngn(p.saved_minor),
    target: ngn(p.amount_minor * BigInt(p.total_count)),
    status: p.status,
    nextDueAt: p.next_due_at,
    closedAt: p.closed_at,
    createdAt: p.created_at,
  };
}

export function groupView(g: GroupRow & { position?: number | null; members?: number }, viewerId: string) {
  return {
    id: g.id,
    name: g.name,
    amount: ngn(g.amount_minor),
    pot: ngn(g.amount_minor * BigInt(g.size)),
    frequency: g.frequency,
    size: g.size,
    members: g.members,
    payoutOrder: g.payout_order,
    // Only members see a group, and any member may invite while it's forming.
    inviteCode: g.status === "forming" ? g.invite_code : null,
    status: g.status,
    currentRound: g.current_round,
    nextDueAt: g.next_due_at,
    startedAt: g.started_at,
    closedAt: g.closed_at,
    createdAt: g.created_at,
    isOrganiser: g.owner_id === viewerId,
    myPosition: g.position ?? null,
  };
}

export function groupDetailView(
  d: {
    group: GroupRow;
    members: { user_id: string; username: string | null; position: number | null; joined_at: Date; owed: bigint }[];
    payouts: { round: number; recipient_id: string; amount_minor: bigint; created_at: Date }[];
  },
  viewerId: string,
) {
  const me = d.members.find((m) => m.user_id === viewerId);
  const nameOf = (uid: string) => d.members.find((m) => m.user_id === uid)?.username ?? "member";
  return {
    group: { ...groupView({ ...d.group, position: me?.position ?? null, members: d.members.length }, viewerId) },
    members: d.members.map((m) => ({
      username: m.username ?? "member",
      position: m.position,
      isMe: m.user_id === viewerId,
      isOrganiser: m.user_id === d.group.owner_id,
      behind: m.owed > 0n,
      // What a member owes is shown to the group: that is how a rotating
      // savings circle keeps itself honest.
      owed: ngn(m.owed),
    })),
    payouts: d.payouts.map((p) => ({
      round: p.round,
      collector: nameOf(p.recipient_id),
      isMe: p.recipient_id === viewerId,
      amount: ngn(p.amount_minor),
      at: p.created_at,
    })),
  };
}
