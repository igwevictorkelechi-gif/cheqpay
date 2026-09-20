/**
 * Client-side (browser) observability bootstrap.
 *
 * The import is DYNAMIC, and that is the whole point of this file's shape.
 *
 * A top-level `import * as Sentry from "@sentry/nextjs"` puts the entire
 * browser SDK — tracing, replay, the lot — into the bundle that every page
 * shares. The `if (dsn)` guard below only decides whether it INITIALISES; by
 * then it has already been downloaded and parsed. That cost 128 kB of shared
 * JavaScript on every route, including /, /about and /terms — the public
 * pages, where a first-time visitor is deciding whether to bother, and where
 * not one line of it can ever be used because there is nothing to report yet.
 *
 * Behind a dynamic import, webpack splits it into its own chunk:
 *   - with no DSN configured, that chunk is never fetched at all;
 *   - with a DSN, it is fetched after hydration instead of blocking first
 *     paint, which is the right priority for an error reporter.
 *
 * The trade is that a handful of route transitions in the first moments after
 * load are not traced, because the SDK has not arrived yet. At a 10% trace
 * sample rate that is a rounding error, and it buys every visitor a materially
 * faster first load.
 */

type SentryModule = typeof import("@sentry/nextjs");

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Resolves once the SDK is loaded and initialised. Null when unconfigured. */
const sentryReady: Promise<SentryModule> | null = dsn
  ? import("@sentry/nextjs").then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
        tracesSampleRate: 0.1,
        // Session Replay stays off. Leaving these at 0 while the integration
        // ships is how the replay bundle ends up being paid for and never used.
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
      });
      return Sentry;
    })
  : null;

/**
 * Report an uncaught error, loading the SDK if it is not up yet. Exported so
 * the error boundary can reach Sentry without importing it statically and
 * undoing the split above.
 */
export function reportError(error: unknown): void {
  void sentryReady?.then((Sentry) => Sentry.captureException(error)).catch(() => {
    /* Observability must never be the thing that breaks the page. */
  });
}

/**
 * Next calls this at the start of a client-side navigation. Forwarded once the
 * SDK is available; transitions before that are dropped rather than queued,
 * since a span that starts late is worse than one that never existed.
 */
export function onRouterTransitionStart(
  ...args: Parameters<SentryModule["captureRouterTransitionStart"]>
): void {
  void sentryReady?.then((Sentry) => Sentry.captureRouterTransitionStart?.(...args));
}
