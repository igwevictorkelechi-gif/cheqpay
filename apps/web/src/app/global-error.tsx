"use client";

import ErrorScreen from "@/components/ErrorScreen";

/**
 * Root error boundary: the last line of defence when the layout itself fails.
 * ErrorScreen reports the error (to our API logs, and Sentry when configured),
 * reloads once after a site update, and shows the error line on screen.
 *
 * Reports through instrumentation-client rather than importing Sentry here: a
 * static import in this file would pull the SDK back into the shared bundle
 * and undo the code-splitting that keeps it off every page that never errors.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <ErrorScreen error={error} reset={reset} />
      </body>
    </html>
  );
}
