"use client";

import { useEffect } from "react";
import { reportError } from "@/instrumentation-client";

/**
 * Root error boundary. Reports uncaught render errors to Sentry (no-op without
 * a DSN) and shows a minimal recovery screen.
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
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            fontFamily: "system-ui, sans-serif",
            padding: 24,
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Something went wrong</h2>
          <p style={{ color: "#666", maxWidth: 360 }}>
            We hit an unexpected error. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#6B5B95",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
