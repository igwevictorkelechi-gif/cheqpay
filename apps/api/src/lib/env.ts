import { z } from "zod";

/**
 * A provider-mode selector that is forgiving of misconfiguration: values are
 * trimmed + lowercased, and anything not in the allow-list falls back to a safe
 * default (with a warning) instead of throwing. This prevents a single bad env
 * var (e.g. a secret key pasted into CUSTODY_PROVIDER) from crashing the whole
 * API. The invalid value is never logged (it may be a secret).
 */
function providerEnum<T extends [string, ...string[]]>(name: string, values: T, fallback: T[number]) {
  return z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.enum(values).catch(() => {
      console.warn(
        `[env] Invalid ${name}; expected one of ${values.join(", ")}. Falling back to "${fallback}".`
      );
      return fallback;
    })
  );
}

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

  // Phase 1 (auth) — Supabase Auth issues the JWTs; we verify them here.
  SUPABASE_JWT_SECRET: z.string().min(16).optional(),
  // Service-role access to the Supabase Admin API (used to delete the auth
  // user on permanent account deletion). Both must be set to take effect.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Admin auth: a trusted service secret (backend-to-backend, e.g. the admin
  // dashboard proxy) AND/OR an email allowlist for admin Supabase users.
  ADMIN_API_SECRET: z.string().min(16).optional(),
  ADMIN_EMAILS: z.string().optional(), // comma-separated

  // AML thresholds (NGN, whole naira). Converted to kobo at use.
  AML_LARGE_AMOUNT_NGN: z.coerce.number().positive().default(1_000_000),
  AML_REVIEW_THRESHOLD_NGN: z.coerce.number().positive().default(5_000_000),
  AML_VELOCITY_COUNT: z.coerce.number().int().positive().default(10),
  AML_VELOCITY_SUM_NGN: z.coerce.number().positive().default(10_000_000),
  SANCTIONED_ADDRESSES: z.string().optional(), // comma-separated

  // Phase 2 (custody — Tatum)
  CUSTODY_PROVIDER: providerEnum("CUSTODY_PROVIDER", ["mock", "tatum"], "mock"),
  TATUM_API_KEY: z.string().optional(),
  TATUM_WEBHOOK_SECRET: z.string().optional(),

  // Phase 3 (Naira rails)
  PAYMENT_PROVIDER: providerEnum("PAYMENT_PROVIDER", ["mock", "flutterwave"], "mock"),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional(),

  // Phase 4 (rates / market data)
  PRICE_FEED: providerEnum("PRICE_FEED", ["live", "mock"], "live"),
  BINANCE_API_BASE: z.string().url().default("https://api.binance.com"),
  // Business-controlled USDT->NGN rate + spread (basis points). The spread is
  // where the business margin lives; both are server-side only.
  BUSINESS_USDT_NGN_RATE: z.coerce.number().positive().optional(),
  SWAP_SPREAD_BPS: z.coerce.number().min(0).max(10_000).default(150), // 1.5%

  // Testing escape hatch. When "true", crypto withdrawals skip the MFA (AAL2)
  // requirement and the KYC tier-2 gate so test accounts can move funds.
  // MUST be off (default) in production — it removes real money safeguards.
  RELAX_WITHDRAWAL_GUARDS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // KYC / identity verification. `mock` auto-verifies on a well-formed BVN;
  // `dojah` performs a real BVN lookup + name match (requires Dojah keys).
  KYC_PROVIDER: providerEnum("KYC_PROVIDER", ["mock", "dojah"], "mock"),
  DOJAH_APP_ID: z.string().optional(),
  DOJAH_API_KEY: z.string().optional(),
  DOJAH_API_BASE: z.string().url().default("https://api.dojah.io"),

  // Scheduled jobs. CRON_SECRET gates the /api/cron/* endpoints (Vercel Cron
  // sends it automatically as `Authorization: Bearer <secret>`).
  CRON_SECRET: z.string().min(16).optional(),
  // Percentage move (since the last alert) that triggers a price notification.
  PRICE_ALERT_THRESHOLD_PCT: z.coerce.number().positive().max(100).default(5),
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
