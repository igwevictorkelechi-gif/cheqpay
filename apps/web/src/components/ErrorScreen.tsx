"use client";

import { useEffect, useState } from "react";
import { reportError } from "@/instrumentation-client";
import {
  errorSummary,
  isChunkLoadError,
  reloadForNewVersion,
  reportClientError,
} from "@/lib/clientErrors";

/**
 * What a customer sees when a page crashes. Inline styles on purpose: the root
 * error boundary replaces the whole layout, so the app's stylesheet may not be
 * there.
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);
  const [reloading, setReloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const summary = errorSummary(error);

  useEffect(() => {
    // The site was updated under an open tab: fetch the new files instead of
    // showing an error the customer can't fix.
    if (chunk && reloadForNewVersion()) {
      setReloading(true);
      return;
    }
    reportClientError(error);
    reportError(error);
  }, [error, chunk]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${summary}\n${window.location.pathname}\n${navigator.userAgent}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const retry = () => (chunk ? window.location.reload() : reset());

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24,
        textAlign: "center",
        background: "#000",
        color: "#fff",
      }}
    >
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
        {reloading ? "Updating CheqPay…" : "Something went wrong"}
      </h2>
      {!reloading && (
        <>
          <p style={{ color: "#9A93AD", maxWidth: 360, margin: 0 }}>
            We hit an unexpected error. Please try again.
          </p>
          <button
            onClick={retry}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#6B5B95",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              minHeight: 44,
            }}
          >
            Try again
          </button>
          <p
            style={{
              color: "#6f6880",
              fontSize: 12,
              maxWidth: 360,
              margin: 0,
              userSelect: "text",
              WebkitUserSelect: "text",
              wordBreak: "break-word",
            }}
          >
            Error details: {summary}
          </p>
          <button
            onClick={copy}
            style={{
              background: "transparent",
              border: "1px solid #3a3446",
              color: "#9A93AD",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12,
              cursor: "pointer",
              minHeight: 32,
            }}
          >
            {copied ? "Copied" : "Copy details"}
          </button>
        </>
      )}
    </div>
  );
}
