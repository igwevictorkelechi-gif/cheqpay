import { z } from "zod";

/**
 * KYC submission. First/last name are required; a valid 11-digit BVN enables
 * automatic verification (tier 2). Without it, the submission goes to the admin
 * review queue.
 */
export const kycTier1Schema = z.object({
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").optional(),
  country: z.string().length(2).default("NG"),
  bvn: z.string().regex(/^\d{11}$/, "Expected an 11-digit BVN").optional(),
  documentRefs: z.array(z.string().min(1)).max(10).default([]),
});
export type KycTier1Input = z.infer<typeof kycTier1Schema>;

/** Admin action on a KYC submission. */
export const kycReviewSchema = z.object({
  recordId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  tier: z.number().int().min(1).max(3).optional(),
});
export type KycReviewInput = z.infer<typeof kycReviewSchema>;

/** Start an NGN deposit. Amount is a decimal NGN string (validated downstream). */
export const depositInitSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Expected an NGN amount like 5000 or 5000.50"),
});
export type DepositInitInput = z.infer<typeof depositInitSchema>;

/**
 * Create the user's NGN virtual account (dedicated NUBAN). Supplying a valid
 * 11-digit BVN mints a PERMANENT account; omitting it mints a temporary one.
 */
export const createVirtualAccountSchema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().min(7).max(20).optional(),
  bvn: z.string().regex(/^\d{11}$/, "Expected an 11-digit BVN").optional(),
});
export type VirtualAccountRequestInput = z.infer<typeof createVirtualAccountSchema>;

/** Resolve a bank account holder's name before a withdrawal. */
export const resolveAccountSchema = z.object({
  accountNumber: z.string().regex(/^\d{10}$/, "Expected a 10-digit NUBAN"),
  bankCode: z.string().min(3).max(10),
});
export type ResolveAccountRequestInput = z.infer<typeof resolveAccountSchema>;

/** Save a withdrawal beneficiary (bank account). Name is resolved server-side. */
export const addBeneficiarySchema = z.object({
  bankCode: z.string().min(3).max(10),
  bankName: z.string().min(1).max(100),
  accountNumber: z.string().regex(/^\d{10}$/, "Expected a 10-digit NUBAN"),
});
export type AddBeneficiaryInput = z.infer<typeof addBeneficiarySchema>;

/** Request an NGN bank payout. */
export const ngnWithdrawalSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Expected an NGN amount like 5000 or 5000.50"),
  bankCode: z.string().min(3).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, "Expected a 10-digit NUBAN"),
  narration: z.string().max(100).optional(),
});
export type NgnWithdrawalInput = z.infer<typeof ngnWithdrawalSchema>;

/** Admin review action on a held withdrawal. */
export const reviewActionSchema = z.object({
  transactionId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});
export type ReviewActionInput = z.infer<typeof reviewActionSchema>;

/** Request a crypto withdrawal to an external address. */
export const cryptoWithdrawalSchema = z.object({
  asset: z.enum(["BTC", "USDT"]),
  network: z.enum(["BITCOIN", "TRON"]),
  toAddress: z.string().min(20).max(120),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal amount"),
});
export type CryptoWithdrawalInput = z.infer<typeof cryptoWithdrawalSchema>;

/** Create a swap quote. `amount` is a decimal string in the FROM asset. */
export const quoteCreateSchema = z.object({
  side: z.enum(["buy", "sell"]),
  asset: z.enum(["BTC", "USDT"]), // the crypto leg
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal amount"),
});
export type QuoteCreateInput = z.infer<typeof quoteCreateSchema>;

/**
 * Create a crypto-to-crypto convert quote (e.g. BTC -> USDT). Both legs are
 * crypto; the price is derived from each asset's USDT spot. `amount` is a
 * decimal string in the FROM asset.
 */
export const convertQuoteSchema = z
  .object({
    fromAsset: z.enum(["BTC", "USDT"]),
    toAsset: z.enum(["BTC", "USDT"]),
    amount: z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal amount"),
  })
  .refine((v) => v.fromAsset !== v.toAsset, {
    message: "fromAsset and toAsset must differ",
    path: ["toAsset"],
  });
export type ConvertQuoteInput = z.infer<typeof convertQuoteSchema>;

/** Execute a previously issued quote. */
export const swapExecuteSchema = z.object({
  quoteId: z.string().uuid(),
});
export type SwapExecuteInput = z.infer<typeof swapExecuteSchema>;

const billService = z.enum(["airtime", "data", "electricity", "cabletv", "betting"]);

/** Validate a bill customer (meter/smartcard) before paying. */
export const billValidateSchema = z.object({
  service: billService,
  billerId: z.string().min(1),
  customer: z.string().min(3).max(64),
});
export type BillValidateInput = z.infer<typeof billValidateSchema>;

/** Pay a bill. `amount` required for variable-amount services; `planId` for fixed. */
export const billPaySchema = z.object({
  service: billService,
  billerId: z.string().min(1),
  customer: z.string().min(3).max(64),
  planId: z.string().min(1).optional(),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal amount").optional(),
});
export type BillPayInput = z.infer<typeof billPaySchema>;

/** Admin update of business-controlled platform settings. */
export const platformSettingsUpdateSchema = z
  .object({
    spreadBps: z.number().int().min(0).max(10_000).optional(),
    usdtNgnRate: z.number().positive().max(1_000_000).optional(),
  })
  .refine((v) => v.spreadBps !== undefined || v.usdtNgnRate !== undefined, {
    message: "Provide at least one of spreadBps or usdtNgnRate",
  });
export type PlatformSettingsUpdate = z.infer<typeof platformSettingsUpdateSchema>;

/** Update per-category notification opt-ins (any subset of booleans). */
export const notificationPrefsSchema = z
  .object({
    deposits: z.boolean().optional(),
    withdrawals: z.boolean().optional(),
    trades: z.boolean().optional(),
    bills: z.boolean().optional(),
    price: z.boolean().optional(),
    security: z.boolean().optional(),
    promos: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one preference to update",
  });
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;

/** Register (or remove) an Expo push token for the current device. */
export const pushTokenSchema = z.object({
  token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, "Invalid Expo push token"),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

/** Update editable profile fields. Username is normalized (leading @ stripped). */
export const profileUpdateSchema = z
  .object({
    username: z
      .string()
      .trim()
      .transform((v) => v.replace(/^@+/, ""))
      .pipe(z.string().regex(/^[a-zA-Z0-9_]{3,20}$/, "3–20 letters, numbers or underscores"))
      .optional(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
      .optional(),
    nextOfKin: z.string().trim().max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to update",
  });
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
