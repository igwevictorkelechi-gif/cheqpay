import { z } from "zod";

/** Tier-1 KYC submission (minimal info; ID/BVN belong to tier 2). */
export const kycTier1Schema = z.object({
  fullName: z.string().min(2).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  country: z.string().length(2).default("NG"),
  documentRefs: z.array(z.string().min(1)).max(10).default([]),
});
export type KycTier1Input = z.infer<typeof kycTier1Schema>;

/** Start an NGN deposit. Amount is a decimal NGN string (validated downstream). */
export const depositInitSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Expected an NGN amount like 5000 or 5000.50"),
});
export type DepositInitInput = z.infer<typeof depositInitSchema>;

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

/** Execute a previously issued quote. */
export const swapExecuteSchema = z.object({
  quoteId: z.string().uuid(),
});
export type SwapExecuteInput = z.infer<typeof swapExecuteSchema>;

/** Admin update of business-controlled platform settings. */
export const platformSettingsUpdateSchema = z
  .object({
    // Spread/margin on the USDT->NGN leg, in basis points (100 bps = 1%).
    spreadBps: z.number().int().min(0).max(10_000).optional(),
    // Business-controlled USDT->NGN rate.
    usdtNgnRate: z.number().positive().max(1_000_000).optional(),
  })
  .refine((v) => v.spreadBps !== undefined || v.usdtNgnRate !== undefined, {
    message: "Provide at least one of spreadBps or usdtNgnRate",
  });
export type PlatformSettingsUpdate = z.infer<typeof platformSettingsUpdateSchema>;
