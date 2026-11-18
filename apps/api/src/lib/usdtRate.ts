// apps/api/src/lib/usdtRate.ts
//
// The business USDT→NGN rate prices every crypto ⇄ Naira trade. It used to be
// typed in by hand, so it drifted from what Maplerad actually pays us for a
// dollar: at ₦1,360 against Maplerad's ₦1,355, every crypto sale lost money.
//
// When the source is "maplerad", the rate follows Maplerad's live USD→NGN
// quote (what they pay us per $1), refreshed at most every LIVE_RATE_TTL_MS.
// The stored row doubles as the cache every instance shares: its updated_at
// says how fresh it is, so one instance's refresh serves them all. A live rate
// that is implausible or jumps more than MAX_JUMP from the stored one is not
// used; the stored rate stays and ops is told. A Maplerad failure never blocks
// a price either: the stored rate is used until a refresh succeeds.

import { after } from "next/server";
import { prisma } from "@cheqpay/db";
import { quoteFx } from "./maplerad/fx";
import { alertOpsOnce } from "./opsAlert";
import { invalidateSetting } from "./settingsCache";

export const USDT_NGN_RATE_KEY = "usdt_ngn_rate";
/** Maplerad's NGN→USD side (what a dollar costs us), followed the same way. */
export const USD_NGN_ASK_RATE_KEY = "usd_ngn_ask_rate";
/** Who the stored row names as its author when the refresh wrote it. */
export const AUTO_UPDATED_BY = "maplerad (auto)";

/** How long a refreshed rate is used before asking Maplerad again. */
export const LIVE_RATE_TTL_MS = 10 * 60 * 1000;
/** After a failed or refused refresh, how long to wait before trying again. */
export const RETRY_AFTER_FAILURE_MS = 2 * 60 * 1000;
/** A move bigger than this between refreshes is held for a human to confirm. */
export const MAX_JUMP = 0.05;
/** Bounds no real NGN-per-dollar rate is outside (also catches an inverted one). */
const MIN_PLAUSIBLE = 100;
const MAX_PLAUSIBLE = 100_000;
/** The quote is for $100, in cents: large enough to price, small enough to be any tier. */
const PROBE_CENTS = 10_000;
const QUOTE_TIMEOUT_MS = 4_000;

export interface FollowedRate {
  rate: number | null;
  /** True when this call fetched the rate from Maplerad just now. */
  fresh: boolean;
}

/** One side of Maplerad's dollar book, followed into its own settings row. */
interface Side {
  key: string;
  fetchLive: () => Promise<number>;
  /** Prefix for ops alert keys, so the two sides never silence each other. */
  alertKey: string;
  /** How the side is named to a human in an alert. */
  label: string;
  inflight: Promise<FollowedRate> | null;
  lastFailureAt: number;
}

const sides: Side[] = [];

/** For tests: forget the in-memory refresh state. */
export function resetUsdtRateState(): void {
  for (const side of sides) {
    side.inflight = null;
    side.lastFailureAt = 0;
  }
}

/**
 * Maplerad's live NGN per $1, from a USD→NGN quote. The rate is read from the
 * two legs, not the quote's own `rate` field, whose direction is not stated.
 */
export async function fetchMapleradUsdNgn(): Promise<number> {
  const fx = await quoteFx(
    { sourceCurrency: "USD", targetCurrency: "NGN", amount: PROBE_CENTS },
    { signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) },
  );
  const cents = Number(fx.source?.amount ?? PROBE_CENTS);
  const kobo = Number(fx.target?.amount);
  if (!Number.isFinite(kobo) || kobo <= 0 || !Number.isFinite(cents) || cents <= 0) {
    throw new Error("Maplerad's quote had no usable amounts");
  }
  return Math.round((kobo / cents) * 100) / 100;
}

/** The NGN→USD probe: ₦140,000, about $100, in kobo. */
const ASK_PROBE_KOBO = 14_000_000;

/**
 * Maplerad's live NGN per $1 when WE buy dollars (an NGN→USD quote). It is
 * the other side of the book from fetchMapleradUsdNgn and is normally dearer:
 * on 18 Nov 2026 Maplerad paid ~₦1,460 for a dollar and charged ~₦1,487 for
 * one. A customer buying dollars from us costs us this rate, not the other.
 */
export async function fetchMapleradNgnUsd(): Promise<number> {
  const fx = await quoteFx(
    { sourceCurrency: "NGN", targetCurrency: "USD", amount: ASK_PROBE_KOBO },
    { signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) },
  );
  const kobo = Number(fx.source?.amount ?? ASK_PROBE_KOBO);
  const cents = Number(fx.target?.amount);
  if (!Number.isFinite(kobo) || kobo <= 0 || !Number.isFinite(cents) || cents <= 0) {
    throw new Error("Maplerad's quote had no usable amounts");
  }
  return Math.round((kobo / cents) * 100) / 100;
}

/** Why a live rate must not be used, or null when it is fine. */
export function rejectLiveRate(live: number, stored: number | null): string | null {
  if (!Number.isFinite(live) || live < MIN_PLAUSIBLE || live > MAX_PLAUSIBLE) {
    return `₦${live} per $1 is not a plausible rate`;
  }
  if (stored !== null && stored > 0 && Math.abs(live - stored) / stored > MAX_JUMP) {
    const pct = (((live - stored) / stored) * 100).toFixed(1);
    return `it moved ${pct}% at once, from ₦${stored} to ₦${live}`;
  }
  return null;
}

/**
 * Let a refresh finish after the response has gone. On serverless a promise
 * nobody awaits is frozen with the instance, so it is handed to after(); with
 * no request in scope (a cron, a test) after() throws and the promise simply
 * runs on.
 */
function finishInBackground(work: Promise<unknown>): void {
  const quiet = work.catch(() => undefined);
  try {
    after(() => quiet);
  } catch {
    /* no request scope */
  }
}

/**
 * The rate to price with, following Maplerad. `stored` and `storedAt` are the
 * current row (or the env seed with no date). Never throws.
 *
 * `wait: false` is for DISPLAY reads only. A stale stored rate is returned at
 * once and the refresh carries on behind the response, so a slow Maplerad can
 * no longer hold a price screen for the length of its timeout — which it did:
 * the stale path used to await the quote, and each serverless instance paid
 * the timeout separately because the failure back-off lives in memory.
 *
 * Anything that PRICES A TRADE must keep the default and wait. The first trade
 * after a quiet night would otherwise be struck at yesterday's rate, which is
 * the exact loss following Maplerad exists to prevent.
 */
export function followMapleradRate(
  stored: number | null,
  storedAt: Date | null,
  now: number = Date.now(),
  opts: { wait?: boolean } = {},
): Promise<FollowedRate> {
  return follow(BID, stored, storedAt, now, opts);
}

/**
 * The same, for the side of the book where we BUY dollars (NGN→USD), kept in
 * its own row. Same TTL, same jump guard, same never-throws contract.
 */
export function followMapleradAsk(
  stored: number | null,
  storedAt: Date | null,
  now: number = Date.now(),
  opts: { wait?: boolean } = {},
): Promise<FollowedRate> {
  return follow(ASK, stored, storedAt, now, opts);
}

async function follow(
  side: Side,
  stored: number | null,
  storedAt: Date | null,
  now: number,
  opts: { wait?: boolean },
): Promise<FollowedRate> {
  const kept = { rate: stored, fresh: false };
  if (stored !== null && storedAt && now - storedAt.getTime() < LIVE_RATE_TTL_MS) return kept;
  if (now - side.lastFailureAt < RETRY_AFTER_FAILURE_MS) return kept;
  if (!side.inflight) {
    side.inflight = refresh(side, stored, storedAt, now).finally(() => {
      side.inflight = null;
    });
  }
  // With nothing stored there is nothing to show, so even a display read waits.
  if (opts.wait === false && stored !== null) {
    finishInBackground(side.inflight);
    return kept;
  }
  return side.inflight;
}

async function refresh(side: Side, stored: number | null, storedAt: Date | null, now: number): Promise<FollowedRate> {
  const kept = { rate: stored, fresh: false };
  let live: number;
  try {
    live = await side.fetchLive();
  } catch (err) {
    side.lastFailureAt = now;
    console.error(`[usdt rate] Maplerad ${side.label} quote failed; pricing stays on the stored rate`, {
      stored,
      error: String(err),
    });
    // Only worth waking someone once the stored rate is genuinely old.
    if (!storedAt || now - storedAt.getTime() > 60 * 60 * 1000) {
      await alertOpsOnce(
        `${side.alertKey}-refresh-failed`,
        `Crypto pricing can't read Maplerad's ${side.label} dollar rate, so it is still using ₦${stored ?? "?"} per $1. Check the rate in Admin → Trading settings.`,
        { error: String(err).slice(0, 200) },
        now,
      );
    }
    return kept;
  }

  const problem = rejectLiveRate(live, stored);
  if (problem) {
    side.lastFailureAt = now;
    console.error("[usdt rate] live rate refused", { side: side.label, stored, live, problem });
    await alertOpsOnce(
      `${side.alertKey}-refused`,
      `Crypto pricing did not follow Maplerad's ${side.label} dollar rate because ${problem}. It is still using ₦${stored} per $1. If the move is real, set the rate in Admin → Trading settings and following resumes from there.`,
      { stored: String(stored), live: String(live) },
      now,
    );
    return kept;
  }

  try {
    // Saving bumps updated_at even when the number is unchanged, which is
    // what tells every other instance the rate is fresh.
    await prisma.platformSetting.upsert({
      where: { key: side.key },
      update: { value: String(live), updatedBy: AUTO_UPDATED_BY },
      create: { key: side.key, value: String(live), updatedBy: AUTO_UPDATED_BY },
    });
    invalidateSetting();
  } catch (err) {
    // The rate is still good to price with; it just isn't shared yet. Back off
    // so a database that won't take the write isn't asked on every price.
    side.lastFailureAt = now;
    console.error("[usdt rate] saving the refreshed rate failed", { side: side.label, live, error: String(err) });
  }
  return { rate: live, fresh: true };
}

/** What Maplerad pays us per $1 (USD→NGN). This is `usdt_ngn_rate`. */
const BID: Side = {
  key: USDT_NGN_RATE_KEY,
  fetchLive: () => fetchMapleradUsdNgn(),
  alertKey: "usdt-rate",
  label: "USD→NGN",
  inflight: null,
  lastFailureAt: 0,
};

/** What Maplerad charges us per $1 (NGN→USD). */
const ASK: Side = {
  key: USD_NGN_ASK_RATE_KEY,
  fetchLive: () => fetchMapleradNgnUsd(),
  alertKey: "usd-ask-rate",
  label: "NGN→USD",
  inflight: null,
  lastFailureAt: 0,
};

sides.push(BID, ASK);
