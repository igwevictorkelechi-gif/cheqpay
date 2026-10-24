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

import { prisma } from "@cheqpay/db";
import { quoteFx } from "./maplerad/fx";
import { alertOpsOnce } from "./opsAlert";
import { invalidateSetting } from "./settingsCache";

export const USDT_NGN_RATE_KEY = "usdt_ngn_rate";
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

let inflight: Promise<FollowedRate> | null = null;
let lastFailureAt = 0;

/** For tests: forget the in-memory refresh state. */
export function resetUsdtRateState(): void {
  inflight = null;
  lastFailureAt = 0;
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
 * The rate to price with, following Maplerad. `stored` and `storedAt` are the
 * current row (or the env seed with no date). Never throws.
 */
export async function followMapleradRate(
  stored: number | null,
  storedAt: Date | null,
  now: number = Date.now(),
): Promise<FollowedRate> {
  const kept = { rate: stored, fresh: false };
  if (stored !== null && storedAt && now - storedAt.getTime() < LIVE_RATE_TTL_MS) return kept;
  if (now - lastFailureAt < RETRY_AFTER_FAILURE_MS) return kept;
  if (!inflight) {
    inflight = refresh(stored, storedAt, now).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function refresh(stored: number | null, storedAt: Date | null, now: number): Promise<FollowedRate> {
  const kept = { rate: stored, fresh: false };
  let live: number;
  try {
    live = await fetchMapleradUsdNgn();
  } catch (err) {
    lastFailureAt = now;
    console.error("[usdt rate] Maplerad quote failed; pricing stays on the stored rate", {
      stored,
      error: String(err),
    });
    // Only worth waking someone once the stored rate is genuinely old.
    if (!storedAt || now - storedAt.getTime() > 60 * 60 * 1000) {
      await alertOpsOnce(
        "usdt-rate-refresh-failed",
        `Crypto pricing can't read Maplerad's dollar rate, so it is still using ₦${stored ?? "?"} per $1. Check the rate in Admin → Trading settings.`,
        { error: String(err).slice(0, 200) },
        now,
      );
    }
    return kept;
  }

  const problem = rejectLiveRate(live, stored);
  if (problem) {
    lastFailureAt = now;
    console.error("[usdt rate] live rate refused", { stored, live, problem });
    await alertOpsOnce(
      "usdt-rate-refused",
      `Crypto pricing did not follow Maplerad's dollar rate because ${problem}. It is still using ₦${stored} per $1. If the move is real, set the rate in Admin → Trading settings and following resumes from there.`,
      { stored: String(stored), live: String(live) },
      now,
    );
    return kept;
  }

  try {
    // Saving bumps updated_at even when the number is unchanged, which is
    // what tells every other instance the rate is fresh.
    await prisma.platformSetting.upsert({
      where: { key: USDT_NGN_RATE_KEY },
      update: { value: String(live), updatedBy: AUTO_UPDATED_BY },
      create: { key: USDT_NGN_RATE_KEY, value: String(live), updatedBy: AUTO_UPDATED_BY },
    });
    invalidateSetting();
  } catch (err) {
    // The rate is still good to price with; it just isn't shared yet. Back off
    // so a database that won't take the write isn't asked on every price.
    lastFailureAt = now;
    console.error("[usdt rate] saving the refreshed rate failed", { live, error: String(err) });
  }
  return { rate: live, fresh: true };
}
