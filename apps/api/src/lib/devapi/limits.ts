import { prisma } from "@cheqpay/db";
import { cachedSetting, invalidateSetting } from "../settingsCache";
import type { AccountRow, Currency } from "./types";

/**
 * Exposure caps for live developer money. These bound the damage any one
 * account can do — a compromised key, a fraudulent business, or a bug — before
 * a human notices:
 *
 *   dailyOut*      money that may leave the account per day (bills, cards)
 *   newDailyOut*   the same, for the first `newAccountDays` after approval
 *   maxFloat*      the most an account may hold across all its live wallets
 *   perTxnMax*     the largest single payment
 *
 * Platform defaults live in settings; an admin can override the daily and
 * float limits per account at approval. All amounts in minor units.
 */
export interface DevLimits {
  dailyOutNgnMinor: number;
  dailyOutUsdMinor: number;
  newDailyOutNgnMinor: number;
  newDailyOutUsdMinor: number;
  maxFloatNgnMinor: number;
  maxFloatUsdMinor: number;
  perTxnMaxNgnMinor: number;
  perTxnMaxUsdMinor: number;
  newAccountDays: number;
}

export const LIMIT_DEFAULTS: DevLimits = {
  dailyOutNgnMinor: 1_000_000_000, // ₦10,000,000
  dailyOutUsdMinor: 1_000_000, // $10,000
  newDailyOutNgnMinor: 100_000_000, // ₦1,000,000
  newDailyOutUsdMinor: 100_000, // $1,000
  maxFloatNgnMinor: 2_000_000_000, // ₦20,000,000
  maxFloatUsdMinor: 2_000_000, // $20,000
  perTxnMaxNgnMinor: 100_000_000, // ₦1,000,000
  perTxnMaxUsdMinor: 250_000, // $2,500
  newAccountDays: 30,
};

const KEY = "developer_limits";

export function mergeLimits(stored: unknown): DevLimits {
  const out = { ...LIMIT_DEFAULTS };
  if (!stored || typeof stored !== "object") return out;
  for (const k of Object.keys(LIMIT_DEFAULTS) as (keyof DevLimits)[]) {
    const v = (stored as Record<string, unknown>)[k];
    const max = k === "newAccountDays" ? 365 : 1_000_000_000_000;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max) out[k] = v;
  }
  return out;
}

async function load(): Promise<DevLimits> {
  const row = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  if (!row) return { ...LIMIT_DEFAULTS };
  try {
    return mergeLimits(JSON.parse(row.value));
  } catch {
    return { ...LIMIT_DEFAULTS };
  }
}

export function getDevLimits(): Promise<DevLimits> {
  return cachedSetting(KEY, load);
}

export async function setDevLimits(next: Partial<DevLimits>, updatedBy: string): Promise<DevLimits> {
  const merged = mergeLimits({ ...(await load()), ...next });
  await prisma.platformSetting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(merged), updatedBy },
    create: { key: KEY, value: JSON.stringify(merged), updatedBy },
  });
  invalidateSetting(KEY);
  return merged;
}

export interface EffectiveLimits {
  newAccount: boolean;
  dailyOut: Record<Currency, bigint>;
  maxFloat: Record<Currency, bigint>;
  perTxnMax: Record<Currency, bigint>;
}

/**
 * The limits that apply to one account right now. An explicit per-account
 * override is the admin's decision and wins as set; otherwise a new account
 * runs on the reduced daily limits until it has been live `newAccountDays`.
 */
export function effectiveLimits(account: AccountRow, d: DevLimits, now: Date = new Date()): EffectiveLimits {
  const liveFor = account.live_since ? now.getTime() - account.live_since.getTime() : 0;
  const newAccount = !account.live_since || liveFor < d.newAccountDays * 86_400_000;
  const daily = (override: bigint | null, normal: number, reduced: number) =>
    override ?? BigInt(newAccount ? Math.min(normal, reduced) : normal);
  return {
    newAccount,
    dailyOut: {
      NGN: daily(account.daily_out_limit_ngn, d.dailyOutNgnMinor, d.newDailyOutNgnMinor),
      USD: daily(account.daily_out_limit_usd, d.dailyOutUsdMinor, d.newDailyOutUsdMinor),
    },
    maxFloat: {
      NGN: account.max_float_ngn ?? BigInt(d.maxFloatNgnMinor),
      USD: account.max_float_usd ?? BigInt(d.maxFloatUsdMinor),
    },
    perTxnMax: { NGN: BigInt(d.perTxnMaxNgnMinor), USD: BigInt(d.perTxnMaxUsdMinor) },
  };
}
