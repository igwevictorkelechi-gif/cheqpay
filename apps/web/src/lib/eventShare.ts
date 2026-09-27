// Share an event so someone else can buy a ticket: a link to the event page.
// Whoever opens it signs in (or signs up) and lands back on the event.

import type { EventItem } from "@/services/api";

export function eventLink(eventId: string): string {
  const origin = typeof window === "undefined" ? "https://mycheqpay.com" : window.location.origin;
  return `${origin}/events/view/?id=${encodeURIComponent(eventId)}`;
}

function when(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}

/**
 * Open the share sheet with the event link. "copied" where the browser has no
 * share sheet (the link goes to the clipboard); "cancelled" when the sheet was
 * closed; "failed" when neither worked.
 */
export async function shareEvent(ev: EventItem): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = eventLink(ev.id);
  const place = [ev.venue, ev.city].filter(Boolean).join(", ");
  const text = [
    `Get tickets for ${ev.title} on CheqPay`,
    [when(ev.startsAt), place].filter(Boolean).join(" · "),
    ev.fromPriceFormatted ? `From ${ev.fromPriceFormatted}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (navigator.share) {
    try {
      await navigator.share({ title: ev.title, text, url });
      return "shared";
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
