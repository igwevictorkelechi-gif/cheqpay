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
  // Cashback rewards, paid in NGN. Rates are per transaction kind because the
  // economics differ (a bill carries margin, a deposit carries a fee, a payout
  // carries neither), and all default to 0 so nothing pays out until set.
  CASHBACK_ENABLED: "cashback_enabled", // "1" | "0" master switch
  CASHBACK_DEPOSIT_BPS: "cashback_deposit_bps",
  CASHBACK_WITHDRAWAL_BPS: "cashback_withdrawal_bps",
  CASHBACK_BILL_BPS: "cashback_bill_bps",
  CASHBACK_TRADE_BPS: "cashback_trade_bps", // buy/sell, on the NGN leg
  CASHBACK_MAX_NGN: "cashback_max_ngn", // per-transaction cap; 0 = uncapped
  // Public support contact details, shown on the app's Help & Support page.
  SUPPORT_EMAIL: "support_email",
  SUPPORT_PHONE: "support_phone",
  SUPPORT_WHATSAPP: "support_whatsapp",
} as const;

export interface SupportContact {
  email: string;
  phone: string;
  whatsapp: string;
}

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

// --- Cashback ---------------------------------------------------------------

/** Admin-controlled cashback rates. All rates are basis points (100 = 1%). */
export interface CashbackConfig {
  enabled: boolean;
  depositBps: number;
  withdrawalBps: number;
  billBps: number;
  tradeBps: number;
  /** Per-transaction ceiling in whole NGN. 0 means no cap. */
  maxNgn: number;
}

export async function getCashbackConfig(): Promise<CashbackConfig> {
  const [enabledRow, depositBps, withdrawalBps, billBps, tradeBps, maxNgn] = await Promise.all([
    prisma.platformSetting.findUnique({ where: { key: SETTING_KEYS.CASHBACK_ENABLED } }),
    getNumberSetting(SETTING_KEYS.CASHBACK_DEPOSIT_BPS, 0),
    getNumberSetting(SETTING_KEYS.CASHBACK_WITHDRAWAL_BPS, 0),
    getNumberSetting(SETTING_KEYS.CASHBACK_BILL_BPS, 0),
    getNumberSetting(SETTING_KEYS.CASHBACK_TRADE_BPS, 0),
    getNumberSetting(SETTING_KEYS.CASHBACK_MAX_NGN, 0),
  ]);
  return {
    enabled: enabledRow?.value === "1",
    depositBps,
    withdrawalBps,
    billBps,
    tradeBps,
    maxNgn,
  };
}

export async function setCashbackConfig(
  patch: Partial<CashbackConfig>,
  updatedBy?: string
): Promise<void> {
  const writes: Promise<unknown>[] = [];
  if (patch.enabled !== undefined)
    writes.push(upsertSetting(SETTING_KEYS.CASHBACK_ENABLED, patch.enabled ? "1" : "0", updatedBy));
  if (patch.depositBps !== undefined)
    writes.push(upsertSetting(SETTING_KEYS.CASHBACK_DEPOSIT_BPS, String(patch.depositBps), updatedBy));
  if (patch.withdrawalBps !== undefined)
    writes.push(
      upsertSetting(SETTING_KEYS.CASHBACK_WITHDRAWAL_BPS, String(patch.withdrawalBps), updatedBy)
    );
  if (patch.billBps !== undefined)
    writes.push(upsertSetting(SETTING_KEYS.CASHBACK_BILL_BPS, String(patch.billBps), updatedBy));
  if (patch.tradeBps !== undefined)
    writes.push(upsertSetting(SETTING_KEYS.CASHBACK_TRADE_BPS, String(patch.tradeBps), updatedBy));
  if (patch.maxNgn !== undefined)
    writes.push(upsertSetting(SETTING_KEYS.CASHBACK_MAX_NGN, String(patch.maxNgn), updatedBy));
  await Promise.all(writes);
}

/** Fee in minor units for a given amount at `bps` basis points (floor). */
export function feeFromBps(amountMinor: bigint, bps: number): bigint {
  if (bps <= 0) return 0n;
  return (amountMinor * BigInt(Math.trunc(bps))) / 10_000n;
}

// --- Support contact (public, admin-editable) --------------------------------

/** Public support contact details. Unset phone/whatsapp render as empty. */
export async function getSupportContact(): Promise<SupportContact> {
  const rows = await prisma.platformSetting.findMany({
    where: {
      key: {
        in: [
          SETTING_KEYS.SUPPORT_EMAIL,
          SETTING_KEYS.SUPPORT_PHONE,
          SETTING_KEYS.SUPPORT_WHATSAPP,
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value.trim()]));
  return {
    // Email defaults to the brand address; phone/whatsapp stay empty until set
    // so the app never shows a placeholder number.
    email: byKey.get(SETTING_KEYS.SUPPORT_EMAIL) || "support@cheqpay.com",
    phone: byKey.get(SETTING_KEYS.SUPPORT_PHONE) || "",
    whatsapp: byKey.get(SETTING_KEYS.SUPPORT_WHATSAPP) || "",
  };
}

export async function setSupportContact(
  patch: Partial<SupportContact>,
  updatedBy?: string
): Promise<void> {
  if (patch.email !== undefined)
    await upsertSetting(SETTING_KEYS.SUPPORT_EMAIL, patch.email.trim(), updatedBy);
  if (patch.phone !== undefined)
    await upsertSetting(SETTING_KEYS.SUPPORT_PHONE, patch.phone.trim(), updatedBy);
  if (patch.whatsapp !== undefined)
    await upsertSetting(SETTING_KEYS.SUPPORT_WHATSAPP, patch.whatsapp.trim(), updatedBy);
}

async function upsertSetting(key: string, value: string, updatedBy?: string) {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value, updatedBy },
    create: { key, value, updatedBy },
  });
}
