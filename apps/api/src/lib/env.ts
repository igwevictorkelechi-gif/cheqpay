import { z } from "zod";

/**
 * Central, validated environment access for the backend.
 *
 * Phase 0 keeps the integration secrets optional so the skeleton boots
 * without a fully provisioned environment. Each becomes REQUIRED in the
 * phase that introduces it (noted inline) — tighten these as we go.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Phase 2+ (database)
  DATABASE_URL: z.string().url().optional(),
  DIRECT_URL: z.string().url().optional(),

  // Phase 1 (auth)
  JWT_SECRET: z.string().min(32).optional(),

  // Phase 2 (custody — Tatum)
  TATUM_API_KEY: z.string().optional(),
  TATUM_WEBHOOK_SECRET: z.string().optional(),

  // Phase 3 (Naira rails — Flutterwave)
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional(),

  // Phase 4 (rates)
  BINANCE_API_BASE: z.string().url().default("https://api.binance.com"),
  // Business-controlled USDT->NGN rate + spread (basis points). The spread is
  // where the business margin lives; both are server-side only.
  BUSINESS_USDT_NGN_RATE: z.coerce.number().positive().optional(),
  SWAP_SPREAD_BPS: z.coerce.number().min(0).max(10_000).default(150), // 1.5%
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${parsed.error.toString()}`
    );
  }
  cached = parsed.data;
  return cached;
}
