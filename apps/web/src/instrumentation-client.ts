import * as Sentry from "@sentry/nextjs";

/**
 * Client-side (browser) observability bootstrap. DSN-guarded via the public env
 * var so it no-ops without configuration. Next.js loads this automatically for
 * the browser bundle.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
