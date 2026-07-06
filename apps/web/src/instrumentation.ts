import * as Sentry from "@sentry/nextjs";

/**
 * Server-side observability bootstrap for the web app. DSN-guarded: with no
 * SENTRY_DSN set this is a no-op, so builds and previews stay green without a
 * Sentry account.
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

export const onRequestError = Sentry.captureRequestError;
