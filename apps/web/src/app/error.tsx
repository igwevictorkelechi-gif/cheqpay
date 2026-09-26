"use client";

import ErrorScreen from "@/components/ErrorScreen";

/**
 * Page-level error boundary. Catches a crash inside one page while keeping the
 * app around it, reports it, and recovers by itself after a site update.
 */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} />;
}
