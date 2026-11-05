// apps/api/src/lib/autoCashout/rules.ts
//
// Pure decisions for auto cash-out, kept free of I/O so they are unit-tested.

export const AUTO_CASHOUT_COINS = ["USDT", "USDC", "BTC"] as const;
export type AutoCashoutCoin = (typeof AUTO_CASHOUT_COINS)[number];

export type AutoCashoutStatus =
  /** Waiting to be sold (or to be retried). */
  | "queued"
  /** Sold for naira; the bank payout is next (or being retried). */
  | "sold"
  /** Sold and the payout is on its way to the bank. */
  | "paid"
  /** Not sold: the coins are still in the wallet (too small, over a limit, turned off…). */
  | "skipped"
  /** Sold, but the payout could not go out: the naira is in the wallet. */
  | "kept_ngn"
  /** Stopped in a state a person must look at. Nothing is retried. */
  | "failed";

export const TERMINAL: ReadonlySet<AutoCashoutStatus> = new Set(["paid", "skipped", "kept_ngn", "failed"]);

/** Attempts per step before giving up and leaving the money where it is. */
export const MAX_ATTEMPTS = 5;

/** Back-off between attempts: 2 min, 10 min, 1 h, 6 h. */
export function retryDelaySeconds(attempt: number): number {
  const steps = [120, 600, 3600, 21_600];
  return steps[Math.min(Math.max(attempt, 1), steps.length) - 1];
}

/**
 * Which coin a credited deposit counts as for the user's choice. A stablecoin
 * that arrived on a network we off-ramp is credited as dollars (USD), but the
 * user sent — and ticked — USDT or USDC, so it is matched by the coin recorded
 * on the deposit. Anything else (NGN, an unknown coin) is never cashed out.
 */
export function depositCoin(asset: string, metadata: unknown): AutoCashoutCoin | null {
  if ((AUTO_CASHOUT_COINS as readonly string[]).includes(asset)) return asset as AutoCashoutCoin;
  if (asset !== "USD") return null;
  const m = (metadata ?? {}) as Record<string, unknown>;
  const offramped = m.offramp === true || m.converted === true || typeof m.coin === "string";
  const coin = typeof m.coin === "string" ? m.coin.toUpperCase() : null;
  if (!offramped || !coin) return null;
  return coin === "USDT" || coin === "USDC" ? coin : null;
}

/** A deposit is queued only when the feature is on for this user and the coin is ticked. */
export function shouldQueue(
  settings: { enabled: boolean; assets: readonly string[]; beneficiaryId: string | null } | null,
  coin: AutoCashoutCoin | null,
): boolean {
  return Boolean(settings?.enabled && settings.beneficiaryId && coin && settings.assets.includes(coin));
}

/**
 * Error codes after which trying again later can succeed: the exchange or the
 * bank was unreachable, or refused without moving anything. Everything else —
 * limits, an account not in the user's name, a balance that is no longer there
 * — will fail the same way next time, so the money stays where it is.
 */
const RETRYABLE_CODES = new Set([
  "fx_quote_failed",
  "fx_failed",
  "fx_direction_unavailable",
  "no_rate",
  "payout_failed",
  "resolve_failed",
  "quote_expired",
  "quote_consumed",
]);

/**
 * Codes where money may have moved without our record of it. Never retried:
 * selling again could sell twice. A person reconciles it.
 */
const DANGEROUS_CODES = new Set(["fx_credit_failed"]);

export type ErrorClass = "retry" | "stop" | "danger";

export function classifyError(err: unknown): ErrorClass {
  const e = err as { code?: unknown; status?: unknown; name?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : null;
  if (code && DANGEROUS_CODES.has(code)) return "danger";
  if (code && RETRYABLE_CODES.has(code)) return "retry";
  // An ApiError with any other code is a definite answer.
  if (code && typeof e?.status === "number") return "stop";
  // Network failures, timeouts, a database blip: nothing definite happened.
  return "retry";
}

/** "GTBank ••1234" — enough to recognise the account without printing it. */
export function maskedAccount(bankName: string, accountNumber: string): string {
  return `${bankName} ••${accountNumber.slice(-4)}`;
}
