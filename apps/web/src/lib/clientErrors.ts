// Crash handling for the web app's error screens.
//
// Two jobs:
//  1. Tell us what broke. The site is uploaded as static files built without an
//     error-reporting key, so a crash on a customer's phone was invisible. The
//     error screens send it to the API, which writes it to its logs.
//  2. Recover after an upload. Replacing the site's files removes the old
//     script chunks an already-open tab still points at; the next page it
//     opens then fails to load its script. One full reload fetches the new
//     files, which is what the customer would have to do by hand anyway.

import { API_BASE } from "@/services/api";

const RELOAD_KEY = "cheqpay.chunkReloadAt";

/** A page's script could not be loaded (usually: the site was updated). */
export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    text,
  );
}

/**
 * Reload once to pick up the new files. Returns false when a reload already
 * happened moments ago, so a genuinely missing file can't loop forever.
 */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* no storage: still reload once; the next failure shows the error screen */
  }
  window.location.reload();
  return true;
}

/** One short line for the error screen, e.g. "TypeError: x is undefined". */
export function errorSummary(error: unknown): string {
  const e = error as { name?: string; message?: string } | null;
  const first = String(e?.message ?? error ?? "Unknown error").split("\n")[0].slice(0, 160);
  return `${e?.name && e.name !== "Error" ? `${e.name}: ` : ""}${first}`;
}

/** Send the error to the API's logs. Never throws; never blocks the screen. */
export function reportClientError(error: unknown): void {
  try {
    const e = error as { name?: string; message?: string; stack?: string; digest?: string } | null;
    const body = JSON.stringify({
      name: String(e?.name ?? "Error").slice(0, 100),
      message: String(e?.message ?? error ?? "Unknown error").slice(0, 500),
      stack: typeof e?.stack === "string" ? e.stack.slice(0, 2_000) : undefined,
      digest: typeof e?.digest === "string" ? e.digest.slice(0, 100) : undefined,
      path: window.location.pathname.slice(0, 200),
      userAgent: navigator.userAgent.slice(0, 300),
    });
    void fetch(`${API_BASE}/api/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* reporting must never be what breaks the page */
  }
}
