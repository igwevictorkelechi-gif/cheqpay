import { getEnv } from "./env";

/**
 * Best-effort operations alert. POSTs a short message to ADMIN_ALERT_WEBHOOK
 * (a Slack/Discord/Zapier-style incoming webhook) when the ops team needs to
 * act — e.g. a manual crypto withdrawal has queued. Never throws and never
 * blocks the request path on failure; a missing webhook is a no-op.
 *
 * The payload includes both `text` (Slack/Discord render this) and structured
 * fields so generic consumers (Zapier, custom endpoints) can use it too.
 */
export async function notifyAdminAlert(
  text: string,
  fields?: Record<string, string>
): Promise<void> {
  const url = getEnv().ADMIN_ALERT_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `content` is Discord's field name; `text` is Slack's. Sending both is
      // harmless and lets one webhook config work with either.
      body: JSON.stringify({ text, content: text, ...(fields ? { fields } : {}) }),
    });
  } catch (err) {
    console.error("[adminAlert] webhook failed", err);
  }
}
