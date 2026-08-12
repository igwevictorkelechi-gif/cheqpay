import { z } from "zod";

/**
 * Provider vars whose configured value was not in the allow-list, so the
 * fallback was used. Recorded rather than thrown: a bad value must not stop the
 * API booting (health checks, login and history have nothing to do with
 * providers), but it must not quietly select the mock money rails either.
 * assertProviderConfigured() turns it into a loud failure at the point of use.
 */
const invalidProviderVars = new Set<string>();

/**
 * A provider-mode selector that is forgiving of misconfiguration: values are
 * trimmed + lowercased, and anything not in the allow-list falls back to a safe
 * default (with a warning) instead of throwing. This prevents a single bad env
 * var (e.g. a secret key pasted into CUSTODY_PROVIDER) from crashing the whole
 * API. The invalid value is never logged (it may be a secret).
 *
 * Forgiving about BOOTING is not the same as forgiving about USE — see
 * assertProviderConfigured.
 */
function providerEnum<T extends [string, ...string[]]>(name: string, values: T, fallback: T[number]) {
  return z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.enum(values).catch(() => {
      invalidProviderVars.add(name);
      console.warn(
        `[env] Invalid ${name}; expected one of ${values.join(", ")}. Falling back to "${fallback}".`
      );
      return fallback;
    })
  );
}

/**
 * True when this process is the live production deployment.
 *
 * VERCEL_ENV distinguishes production from preview; NODE_ENV cannot, because
 * Vercel sets it to "production" for preview builds too. Falls back to NODE_ENV
 * for hosts that do not set VERCEL_ENV (e.g. Render), where a production build
 * IS the production deployment.
 */
export function isLiveDeployment(): boolean {
  const vercel = process.env.VERCEL_ENV;
  if (vercel) return vercel === "production";
  return process.env.NODE_ENV === "production";
}

/**
 * Refuse to serve a money path whose provider var is misconfigured.
 *
 * A typo in PAYMENT_PROVIDER used to silently select the mock rail, which
 * answers a deposit request with an invented 10-digit "Mock Test Bank" account
 * number. Nothing errors; the screen looks correct; money sent there is gone.
 * Failing loudly here is strictly better than any amount of fake success.
 */
export function assertProviderConfigured(name: string): void {
  if (invalidProviderVars.has(name)) {
    throw new Error(
      `${name} is set to a value that is not recognised, so it fell back to a ` +
        `mock provider. Mock providers invent account numbers and auto-approve ` +
        `identities, so this request is refused rather than served with fake ` +
        `data. Fix ${name} in the deployment's environment variables.`
    );
  }
}

/**
 * Refuse a mock provider on the live deployment.
 *
 * Explicitly choosing mock is legitimate locally and on previews; on the
 * production deployment it means real users are being handed fake bank
 * accounts and auto-approved KYC. Separate from assertProviderConfigured,
 * which catches typos rather than deliberate choices.
 */
export function assertNotMockInProduction(name: string, value: string): void {
  if (value === "mock" && isLiveDeployment()) {
    throw new Error(
      `${name}=mock on the production deployment. Mock providers invent account ` +
        `numbers, auto-approve identities and settle nothing, so they must never ` +
        `serve real users. Set ${name} to a real provider.`
    );
  }
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

  // Public origin of this API (e.g. https://cheqpay-admin453.vercel.app). Used
  // to build the webhook callback URLs we register with providers. No
  // trailing slash.
  API_PUBLIC_URL: z.string().url().optional(),

  // Phase 2 (custody). Maplerad stablecoin (USDT/USDC) is the only provider;
  // "mock" keeps dev and tests free of external calls. No provider offers BTC —
  // it stays "coming soon" until a BTC custodian is wired.
  CUSTODY_PROVIDER: providerEnum("CUSTODY_PROVIDER", ["mock", "maplerad"], "mock"),

  // Phase 3 (Naira rails). Maplerad is the rail: bills, payouts, name enquiry
  // and banks. "mock" (the default) keeps dev and tests free of external calls.
  PAYMENT_PROVIDER: providerEnum("PAYMENT_PROVIDER", ["mock", "maplerad"], "mock"),
  MAPLERAD_SECRET_KEY: z.string().optional(),
  MAPLERAD_BASE_URL: z.string().url().default("https://api.maplerad.com/v1"),
  // Svix signing secret — verifies inbound Maplerad webhooks (payout settlement
  // today; deposits once Maplerad enables collections).
  MAPLERAD_WEBHOOK_SECRET: z.string().optional(),

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
  KYC_PROVIDER: providerEnum("KYC_PROVIDER", ["mock", "dojah", "maplerad"], "mock"),
  DOJAH_APP_ID: z.string().optional(),
  DOJAH_API_KEY: z.string().optional(),
  DOJAH_API_BASE: z.string().url().default("https://api.dojah.io"),

  // AI support agent (/api/support/chat). Optional — without it the endpoint
  // degrades to a "contact human support" reply instead of erroring.
  ANTHROPIC_API_KEY: z.string().optional(),

  // Optional operations alerting. When set, a JSON message is POSTed here
  // whenever a withdrawal needs the operations team (e.g. a manual crypto
  // payout queues, or a payout is held for review). Works with Slack /
  // Discord / Zapier "incoming webhook" URLs — no extra service required.
  ADMIN_ALERT_WEBHOOK: z.string().url().optional(),

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
