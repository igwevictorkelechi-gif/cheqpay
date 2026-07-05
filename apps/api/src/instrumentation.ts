import * as Sentry from "@sentry/nextjs";

/**
 * Server-side observability bootstrap. DSN-guarded: with no SENTRY_DSN set this
 * is a no-op, so local dev and preview builds stay green without any Sentry
 * account. Errors are additionally captured explicitly in `toErrorResponse`.
 */
export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

// Report uncaught errors thrown while handling a request (Next 15 hook).
export const onRequestError = Sentry.captureRequestError;
