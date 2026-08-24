import * as Sentry from "@sentry/nextjs";

/**
 * Server-side bootstrap: observability, then schema.
 *
 * Runs once per server start (per cold start on serverless), before any request
 * is handled — which is exactly what the schema work needs and did not have.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      // Host-agnostic: Vercel sets VERCEL_ENV, Render sets RENDER_SERVICE_TYPE
      // but no environment name, so fall back to NODE_ENV.
      environment: process.env.VERCEL_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
  }

  await ensureSchema();
  await checkPiiKey();
}

/**
 * Announce a missing or malformed PII_ENCRYPTION_KEY at boot.
 *
 * Without this the only way to discover the key is wrong is to submit a KYC
 * form and read the logs — the encryption sits inside a best-effort block, so a
 * bad key costs a stored BVN and says nothing to anyone watching. Checking here
 * costs one string decode per cold start.
 *
 * Logged, never thrown, for the same reason as the schema helpers above: an API
 * that refuses to boot is worse than one running with a named gap. The value is
 * never logged — only the verdict.
 */
async function checkPiiKey(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { piiKeyStatus } = await import("@/lib/piiKey");
    const status = piiKeyStatus();
    if (status === "invalid") {
      console.error(
        "[bootstrap] PII_ENCRYPTION_KEY is set but unusable — it must be base64 " +
          "decoding to exactly 32 bytes. Generate one with: openssl rand -base64 32. " +
          "Until it is fixed, BVNs are NOT retained and admin BVN search is unavailable."
      );
    } else if (status === "unset") {
      console.warn(
        "[bootstrap] PII_ENCRYPTION_KEY is not set — BVNs will not be retained. " +
          "This is an AML record-keeping gap."
      );
    }
  } catch (err) {
    console.error("[bootstrap] could not check PII_ENCRYPTION_KEY", err);
  }
}

/**
 * Apply the lazily-managed schema before serving anything.
 *
 * Migrations are not run on deploy in this project, so newer tables and columns
 * are created by idempotent `ensure*` helpers. Those used to run on first use of
 * the feature that needed them — which is safe for a NEW TABLE that only new
 * code touches, and unsafe for a NEW COLUMN on an existing table.
 *
 * The difference matters because Prisma selects every column the model declares
 * on every query of that model. The moment `User` gained `legal_name` and the
 * `bvn_*` columns, EVERY query returning a User emitted them — including
 * `SELECT`s and `UPDATE ... RETURNING`. But the helper that creates them only
 * ran on KYC submission or account closure, so until someone did one of those,
 * every one of those queries failed with "column does not exist". That is what
 * happened in production: /api/me, KYC and transfers were all failing while the
 * feature that would have created the columns sat waiting to be used.
 *
 * Running here removes the ordering hazard entirely: the columns exist before
 * the first query, regardless of which feature is exercised first.
 *
 * Failure is logged, not thrown. A boot that cannot reach the database should
 * retry on the next request rather than refuse to start; the helpers memoize
 * and will run again.
 */
async function ensureSchema(): Promise<void> {
  // `register` is compiled for the Edge runtime as well as Node, and these
  // modules reach node:crypto and Prisma — neither of which Edge has. Without
  // this guard webpack tries to bundle them for Edge and the build fails.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    // Imported lazily so the module graph above stays free of them.
    const [
      { ensureRetentionSchema },
      { ensureActivitySchema },
      { ensureMapleradSchema, ensureKycDocSchema },
    ] = await Promise.all([
      import("@/lib/retention"),
      import("@/lib/activity"),
      import("@/lib/mapleradCustomer"),
    ]);
    await Promise.all([
      ensureRetentionSchema(),
      ensureActivitySchema(),
      // maplerad_tier + the address columns. Omitting this is what broke the
      // admin user list, KYC and virtual accounts in production: the columns
      // were only created on KYC submission, but every User query selected them,
      // so KYC itself failed before it could create them. Nothing that adds a
      // column to an existing model may be left out of this list.
      ensureMapleradSchema(),
      // The government-ID columns, same hazard: every User query selects them.
      ensureKycDocSchema(),
    ]);
    // NB: the KYC document TABLE (image bytes) is created lazily by
    // lib/kycDocuments on first use, not here. It is a new table, so it is
    // select-all-safe, and that module reaches node:crypto — which the Edge
    // compile of this file cannot bundle. Keeping it out of the boot graph is
    // deliberate (see retention.ts, which uses Web Crypto for the same reason).
  } catch (err) {
    console.error("[bootstrap] schema preparation failed; will retry on next start", err);
  }
}

// Report uncaught errors thrown while handling a request (Next 15 hook).
export const onRequestError = Sentry.captureRequestError;
