import { prisma } from "@cheqpay/db";
import { getEnv } from "./env";
import { ApiError } from "./http";

export const SETTING_KEYS = {
  SWAP_SPREAD_BPS: "swap_spread_bps",
  USDT_NGN_RATE: "usdt_ngn_rate",
  // Business fees, admin-set from the dashboard. All default to 0 (off).
  DEPOSIT_FEE_BPS: "deposit_fee_bps", // % of each NGN deposit, in basis points
  WITHDRAWAL_FEE_NGN: "withdrawal_fee_ngn", // flat NGN fee per bank payout
  BILL_MARGIN_BPS: "bill_margin_bps", // default markup on bill payments, in bps
  // Per-service bill margins. Each overrides BILL_MARGIN_BPS for that service
  // alone, because the economics differ sharply: a data bundle's wholesale
  // price is invisible to the buyer, while everyone knows ₦100 of airtime
  // should cost ₦100. Unset means "use the default".
  BILL_MARGIN_AIRTIME_BPS: "bill_margin_airtime_bps",
  BILL_MARGIN_DATA_BPS: "bill_margin_data_bps",
  BILL_MARGIN_ELECTRICITY_BPS: "bill_margin_electricity_bps",
  BILL_MARGIN_CABLETV_BPS: "bill_margin_cabletv_bps",
  BILL_MARGIN_BETTING_BPS: "bill_margin_betting_bps",
  BILL_MARGIN_FOOD_BPS: "bill_margin_food_bps",
  // Spread taken on a NGN⇄USD conversion, which settles on Maplerad's FX rail
  // rather than the synthetic USDT peg — so SWAP_SPREAD_BPS never reaches it
  // and it needs a margin of its own.
  FX_MARGIN_BPS: "fx_margin_bps",
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

/** The bill services that can carry their own margin. */
export type BillMarginService =
  | "airtime"
  | "data"
  | "electricity"
  | "cabletv"
  | "betting"
  | "food";

const BILL_MARGIN_KEYS: Record<BillMarginService, string> = {
  airtime: SETTING_KEYS.BILL_MARGIN_AIRTIME_BPS,
  data: SETTING_KEYS.BILL_MARGIN_DATA_BPS,
  electricity: SETTING_KEYS.BILL_MARGIN_ELECTRICITY_BPS,
  cabletv: SETTING_KEYS.BILL_MARGIN_CABLETV_BPS,
  betting: SETTING_KEYS.BILL_MARGIN_BETTING_BPS,
  food: SETTING_KEYS.BILL_MARGIN_FOOD_BPS,
};

/**
 * Profit margin (basis points) added on top of a bill payment. 0 = none.
 *
 * With a service, its own rate wins when one is set and the shared default
 * applies otherwise — so an admin can price data at 3% and still sell airtime
 * at face value. Note that an explicit 0 is a real answer, not "unset": it is
 * how you hold one service at face value while the default is non-zero.
 */
export async function getBillMarginBps(service?: BillMarginService): Promise<number> {
  const fallback = () => getNumberSetting(SETTING_KEYS.BILL_MARGIN_BPS, 0);
  if (!service) return fallback();

  const row = await prisma.platformSetting.findUnique({
    where: { key: BILL_MARGIN_KEYS[service] },
  });
  return row ? parseNonNegNumber(row.value, BILL_MARGIN_KEYS[service]) : fallback();
}

/** Every bill margin, for the admin dashboard. Null means "uses the default". */
export async function getBillMargins(): Promise<{
  defaultBps: number;
  perService: Record<BillMarginService, number | null>;
}> {
  const services = Object.keys(BILL_MARGIN_KEYS) as BillMarginService[];
  const [defaultBps, rows] = await Promise.all([
    getNumberSetting(SETTING_KEYS.BILL_MARGIN_BPS, 0),
    prisma.platformSetting.findMany({
      where: { key: { in: services.map((s) => BILL_MARGIN_KEYS[s]) } },
    }),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const perService = Object.fromEntries(
    services.map((s) => {
      const raw = byKey.get(BILL_MARGIN_KEYS[s]);
      return [s, raw === undefined ? null : parseNonNegNumber(raw, BILL_MARGIN_KEYS[s])];
    }),
  ) as Record<BillMarginService, number | null>;
  return { defaultBps, perService };
}

/** Set one service's margin, or clear it back to the default with null. */
export async function setBillMarginForService(
  service: BillMarginService,
  bps: number | null,
  updatedBy?: string,
): Promise<void> {
  const key = BILL_MARGIN_KEYS[service];
  if (bps === null) {
    await prisma.platformSetting.deleteMany({ where: { key } });
    return;
  }
  await upsertSetting(key, String(bps), updatedBy);
}

/**
 * Spread (basis points) taken on a NGN⇄USD conversion. 0 = none.
 *
 * Separate from SWAP_SPREAD_BPS because these two never meet: the crypto
 * spread is applied to a price we compute ourselves, while this is withheld
 * from an amount Maplerad's FX rail returns.
 */
export function getFxMarginBps(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.FX_MARGIN_BPS, 0);
}

export async function setFxMarginBps(bps: number, updatedBy?: string) {
  await upsertSetting(SETTING_KEYS.FX_MARGIN_BPS, String(bps), updatedBy);
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
