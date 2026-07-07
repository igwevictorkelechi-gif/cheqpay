import { prisma } from "@cheqpay/db";
import { getEnv } from "./env";
import { ApiError } from "./http";

export const SETTING_KEYS = {
  SWAP_SPREAD_BPS: "swap_spread_bps",
  USDT_NGN_RATE: "usdt_ngn_rate",
  // Business fees, admin-set from the dashboard. All default to 0 (off).
  DEPOSIT_FEE_BPS: "deposit_fee_bps", // % of each NGN deposit, in basis points
  WITHDRAWAL_FEE_NGN: "withdrawal_fee_ngn", // flat NGN fee per bank payout
  BILL_MARGIN_BPS: "bill_margin_bps", // markup on bill payments, in basis points
} as const;

// --- Pure parsers/validators (unit-tested, no DB) ---------------------------

export function parseSpreadBps(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) {
    throw new ApiError(500, `Invalid stored spread_bps: ${raw}`, "bad_setting");
  }
  return n;
}

export function parseUsdtNgnRate(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ApiError(500, `Invalid stored usdt_ngn_rate: ${raw}`, "bad_setting");
  }
  return n;
}

// --- DB-backed accessors (env value seeds the default) ----------------------

/** Current swap spread in basis points. Admin-set value wins; else env seed. */
export async function getSwapSpreadBps(): Promise<number> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: SETTING_KEYS.SWAP_SPREAD_BPS },
  });
  return row ? parseSpreadBps(row.value) : getEnv().SWAP_SPREAD_BPS;
}

/** Current business USDT->NGN rate, or null if never set. */
export async function getUsdtNgnRate(): Promise<number | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: SETTING_KEYS.USDT_NGN_RATE },
  });
  if (row) return parseUsdtNgnRate(row.value);
  const seed = getEnv().BUSINESS_USDT_NGN_RATE;
  return seed ?? null;
}

export async function setSwapSpreadBps(
  bps: number,
  updatedBy?: string
): Promise<void> {
  await upsertSetting(SETTING_KEYS.SWAP_SPREAD_BPS, String(bps), updatedBy);
}

export async function setUsdtNgnRate(
  rate: number,
  updatedBy?: string
): Promise<void> {
  await upsertSetting(SETTING_KEYS.USDT_NGN_RATE, String(rate), updatedBy);
}

// --- Business fees (all default to 0 = disabled) -----------------------------

function parseNonNegNumber(raw: string, key: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ApiError(500, `Invalid stored ${key}: ${raw}`, "bad_setting");
  }
  return n;
}

async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row ? parseNonNegNumber(row.value, key) : fallback;
}

/** Percentage fee (basis points) taken from each NGN deposit. 0 = free. */
export function getDepositFeeBps(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.DEPOSIT_FEE_BPS, 0);
}

/** Flat NGN fee added to each bank withdrawal. 0 = free. */
export function getWithdrawalFeeNgn(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.WITHDRAWAL_FEE_NGN, 0);
}

/** Profit margin (basis points) added on top of each bill payment. 0 = none. */
export function getBillMarginBps(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.BILL_MARGIN_BPS, 0);
}

export async function setDepositFeeBps(bps: number, updatedBy?: string) {
  await upsertSetting(SETTING_KEYS.DEPOSIT_FEE_BPS, String(bps), updatedBy);
}
export async function setWithdrawalFeeNgn(ngn: number, updatedBy?: string) {
  await upsertSetting(SETTING_KEYS.WITHDRAWAL_FEE_NGN, String(ngn), updatedBy);
}
export async function setBillMarginBps(bps: number, updatedBy?: string) {
  await upsertSetting(SETTING_KEYS.BILL_MARGIN_BPS, String(bps), updatedBy);
}

/** Fee in minor units for a given amount at `bps` basis points (floor). */
export function feeFromBps(amountMinor: bigint, bps: number): bigint {
  if (bps <= 0) return 0n;
  return (amountMinor * BigInt(Math.trunc(bps))) / 10_000n;
}

async function upsertSetting(key: string, value: string, updatedBy?: string) {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value, updatedBy },
    create: { key, value, updatedBy },
  });
}
