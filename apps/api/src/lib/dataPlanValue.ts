// apps/api/src/lib/dataPlanValue.ts
//
// Ranking data bundles by what they are actually worth.
//
// A provider's bundle list arrives in whatever order the provider stores it,
// which is usually by internal code — so the cheapest-per-gigabyte plan can sit
// anywhere in a list of forty. That makes the customer compare prices by hand.
// This module turns each bundle into comparable numbers (volume, validity,
// naira per gigabyte) and marks the genuinely good deals, so the apps can lead
// with them instead of showing the provider's arbitrary order.
//
// Pure and provider-agnostic: it reads the structured `data`/`validity` fields
// when the provider sends them (Maplerad does) and falls back to reading the
// display name when it does not. Nothing here talks to a database or a network.

import type { BillPlan } from "./bills";

export type PlanBucket = "daily" | "weekly" | "monthly" | "extended" | "other";

export interface PlanValue {
  /** Volume in megabytes, or null when it could not be read. */
  sizeMb: number | null;
  /** Volume rendered the way a customer reads it: "250MB", "1GB", "1.5GB". */
  sizeLabel: string | null;
  /** How many days it lasts, or null when it could not be read. */
  days: number | null;
  /** Validity rendered for display: "1 Day", "30 Days". */
  validityLabel: string | null;
  /** Naira per gigabyte — the value metric everything is ranked on. */
  nairaPerGb: number | null;
  bucket: PlanBucket;
  /** True for the plans worth leading with (see pickHot). */
  hot: boolean;
  /** True for the single best naira-per-gigabyte plan in the list. */
  bestValue: boolean;
}

export type ValuedPlan = BillPlan & PlanValue;

const MB_PER = { KB: 1 / 1024, MB: 1, GB: 1024, TB: 1024 * 1024 } as const;

/**
 * Read a data volume out of a string, in megabytes.
 *
 * Accepts "1GB", "1.5 GB", "500MB", "1TB". Returns null rather than guessing
 * when there is no unit to anchor the number — an unlabelled "20" could be
 * megabytes or gigabytes, and ranking on the wrong one would recommend the
 * worst plan as the best.
 */
export function parseVolumeMb(input: string | null | undefined): number | null {
  if (!input) return null;
  const m = /(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB)\b/i.exec(input);
  if (!m) return null;
  const unit = m[2].toUpperCase() as keyof typeof MB_PER;
  const mb = parseFloat(m[1]) * MB_PER[unit];
  return Number.isFinite(mb) && mb > 0 ? mb : null;
}

/**
 * Read a validity out of a string, in days.
 *
 * Handles both "30 days" and the bare words providers use ("Monthly",
 * "Weekly"). Months are counted as 30 days and years as 365 — close enough to
 * bucket by, and never used for billing.
 */
export function parseDays(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = input.toLowerCase();

  const m = /(\d+)\s*(day|week|month|year)s?\b/.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    const mult = { day: 1, week: 7, month: 30, year: 365 }[m[2] as "day"];
    const days = n * mult;
    return days > 0 ? days : null;
  }

  if (/\bdaily\b/.test(s)) return 1;
  if (/\bweekly\b/.test(s)) return 7;
  if (/\bmonthly\b/.test(s)) return 30;
  if (/\byearly\b|\bannual\b/.test(s)) return 365;
  return null;
}

/** Which duration tab a plan belongs under. */
export function bucketFor(days: number | null): PlanBucket {
  if (days === null) return "other";
  if (days <= 1) return "daily";
  if (days <= 7) return "weekly";
  if (days <= 31) return "monthly";
  return "extended";
}

/** Volume rendered the way a customer reads it. */
export function formatSize(mb: number | null): string | null {
  if (mb === null) return null;
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : Number(gb.toFixed(2))}GB`;
  }
  return `${Number.isInteger(mb) ? mb : Number(mb.toFixed(1))}MB`;
}

/** Validity rendered for display. */
export function formatValidity(days: number | null): string | null {
  if (days === null) return null;
  if (days === 1) return "1 Day";
  if (days === 365) return "1 Year";
  if (days % 30 === 0 && days >= 30) {
    const months = days / 30;
    return months === 1 ? "30 Days" : `${months} Months`;
  }
  return `${days} Days`;
}

/**
 * Choose the plans to lead with.
 *
 * Not simply "the N cheapest per gigabyte": that fills the whole shelf with
 * 30-day bundles, because long bundles are almost always better value per
 * gigabyte than a one-day one. Someone who wants data for today is not helped
 * by being shown five monthly plans.
 *
 * So it takes the best-value plan in each duration bucket FIRST — the best deal
 * each kind of plan offers — and only then fills the remaining slots with the
 * next best overall. The result is ordered by value, so the strongest deal
 * still leads.
 */
function pickHot(valued: ValuedPlan[], limit: number): Set<string> {
  const ranked = valued
    .filter((p) => p.nairaPerGb !== null)
    .sort((a, b) => a.nairaPerGb! - b.nairaPerGb!);

  const chosen = new Set<string>();
  const seen = new Set<PlanBucket>();

  for (const p of ranked) {
    if (chosen.size >= limit) break;
    if (!seen.has(p.bucket)) {
      seen.add(p.bucket);
      chosen.add(p.id);
    }
  }
  for (const p of ranked) {
    if (chosen.size >= limit) break;
    chosen.add(p.id);
  }
  return chosen;
}

/**
 * Annotate a biller's data plans with their value, and mark the good ones.
 *
 * Returns them sorted best-value first so a caller that ignores the buckets
 * still shows the strongest deal at the top. Plans whose volume could not be
 * read keep their original relative order and sort last — they are still
 * purchasable, they just cannot be compared.
 */
export function valueDataPlans(plans: BillPlan[], hotLimit = 8): ValuedPlan[] {
  const valued: ValuedPlan[] = plans.map((p) => {
    // Prefer the provider's structured fields; fall back to the display name.
    const sizeMb = parseVolumeMb(p.data) ?? parseVolumeMb(p.name);
    const days = parseDays(p.validity) ?? parseDays(p.name);
    const naira = Number(p.amount);
    const nairaPerGb =
      sizeMb && sizeMb > 0 && Number.isFinite(naira) && naira > 0
        ? naira / (sizeMb / 1024)
        : null;

    return {
      ...p,
      sizeMb,
      sizeLabel: formatSize(sizeMb),
      days,
      validityLabel: formatValidity(days),
      nairaPerGb: nairaPerGb === null ? null : Number(nairaPerGb.toFixed(2)),
      bucket: bucketFor(days),
      hot: false,
      bestValue: false,
    };
  });

  const hot = pickHot(valued, hotLimit);
  let best: ValuedPlan | null = null;
  for (const p of valued) {
    if (p.nairaPerGb === null) continue;
    if (!best || p.nairaPerGb < best.nairaPerGb!) best = p;
  }

  for (const p of valued) {
    p.hot = hot.has(p.id);
    p.bestValue = best !== null && p.id === best.id;
  }

  // Best value first; unrankable plans last, order preserved.
  return valued
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const av = a.p.nairaPerGb;
      const bv = b.p.nairaPerGb;
      if (av === null && bv === null) return a.i - b.i;
      if (av === null) return 1;
      if (bv === null) return -1;
      return av - bv || a.i - b.i;
    })
    .map(({ p }) => p);
}
