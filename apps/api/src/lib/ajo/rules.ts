// apps/api/src/lib/ajo/rules.ts
//
// Pure Ajo rules, free of I/O so they are unit-tested: schedules, limits,
// fees, invite codes, payout order and how arrears are settled.

import { randomInt } from "node:crypto";

export const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** Contributions due at 08:00 UTC = 9am in Lagos, so debits land in the morning. */
export const DUE_HOUR_UTC = 8;

/** Longest plan per frequency: about a year of dailies, two years of weeklies, five of monthlies. */
export const MAX_COUNT: Record<Frequency, number> = { daily: 366, weekly: 104, monthly: 60 };

export const MIN_AMOUNT_NGN = 100;
export const MIN_GROUP_SIZE = 2;
export const MAX_GROUP_SIZE = 30;
/** Largest pot a group may collect in one round (kobo): NGN 20,000,000. */
export const MAX_POT_KOBO = 2_000_000_000n;
/** Group Ajo moves money between people, so it needs a verified government ID. */
export const GROUP_MIN_TIER = 2;
/** Personal Ajo only moves the user's own money, so Tier 1 is enough. */
export const PLAN_MIN_TIER = 1;

/** The due time after `from`: the next period, at 08:00 UTC that day. */
export function nextDueAfter(from: Date, frequency: Frequency): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), DUE_HOUR_UTC));
  if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else {
    // Same day next month, clamped to the month's last day (31 Jan -> 28/29 Feb).
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}

/** Fee kept when a personal plan is broken before it ends (basis points of what was saved). */
export function breakFee(savedKobo: bigint, bps: number): bigint {
  if (savedKobo <= 0n || bps <= 0) return 0n;
  return (savedKobo * BigInt(Math.round(bps))) / 10_000n;
}

export interface PlanInput {
  amountKobo: bigint;
  frequency: Frequency;
  count: number;
}

/** A user-facing reason the plan can't be created, or null. */
export function planProblem(p: PlanInput, singleTxLimitKobo: bigint): string | null {
  if (p.amountKobo < BigInt(MIN_AMOUNT_NGN * 100)) return `The smallest Ajo contribution is ₦${MIN_AMOUNT_NGN}.`;
  if (p.amountKobo > singleTxLimitKobo) return "That amount is above your per-transaction limit. Upgrade your verification to save more each time.";
  if (!Number.isInteger(p.count) || p.count < 2) return "Choose at least 2 contributions.";
  if (p.count > MAX_COUNT[p.frequency]) return `A ${p.frequency} plan can have at most ${MAX_COUNT[p.frequency]} contributions.`;
  return null;
}

export interface GroupInput {
  amountKobo: bigint;
  frequency: Frequency;
  size: number;
}

export function groupProblem(g: GroupInput, singleTxLimitKobo: bigint): string | null {
  if (g.amountKobo < BigInt(MIN_AMOUNT_NGN * 100)) return `The smallest Ajo contribution is ₦${MIN_AMOUNT_NGN}.`;
  if (g.amountKobo > singleTxLimitKobo) return "That contribution is above your per-transaction limit.";
  if (!Number.isInteger(g.size) || g.size < MIN_GROUP_SIZE || g.size > MAX_GROUP_SIZE) {
    return `A group needs between ${MIN_GROUP_SIZE} and ${MAX_GROUP_SIZE} members.`;
  }
  if (g.amountKobo * BigInt(g.size) > MAX_POT_KOBO) return "The pot would be over ₦20,000,000. Lower the amount or the group size.";
  return null;
}

/** Invite codes avoid 0/O and 1/I/L, which people misread when sharing them. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function inviteCode(rand: (max: number) => number = randomInt): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return out;
}

export function normaliseInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Collecting positions (1 = collects first). "join" keeps the order people
 * joined in; "random" shuffles with a cryptographic random source, so nobody,
 * the organiser included, can choose the early spots.
 */
export function payoutOrder<T>(joinOrder: readonly T[], mode: "join" | "random", rand: (max: number) => number = randomInt): T[] {
  const out = [...joinOrder];
  if (mode === "random") {
    for (let i = out.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

export interface Owed {
  id: string;
  owedKobo: bigint;
}

/** Spread what a member has across what they owe, oldest first. Partial payments allowed. */
export function allocateArrears(availableKobo: bigint, owedOldestFirst: readonly Owed[]): { id: string; payKobo: bigint }[] {
  let left = availableKobo;
  const out: { id: string; payKobo: bigint }[] = [];
  for (const o of owedOldestFirst) {
    if (left <= 0n) break;
    const pay = o.owedKobo < left ? o.owedKobo : left;
    if (pay > 0n) {
      out.push({ id: o.id, payKobo: pay });
      left -= pay;
    }
  }
  return out;
}
