// apps/api/src/lib/whatsapp/client.ts
//
// Sending a WhatsApp message. Thin on purpose: one POST to the Cloud API,
// reusing the social publisher's fetch wrapper so timeouts and network failures
// behave the same way everywhere.
//
// A reply is NOT the webhook's HTTP response — it is a separate call made here.
// That is what lets the webhook acknowledge Meta immediately and answer after,
// which is the whole reason the bot can afford to think before replying.
//
// Deliberately provider-agnostic at the edge: `sendText` is the only thing the
// rest of the bot calls, so moving to a BSP later is one file.

import { clip, http } from "../social/providers/http";

export interface SendResult {
  ok: boolean;
  /** Meta's message id (wamid.*) when it accepted the message. */
  messageId?: string;
  error?: string;
}

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());
}

function endpoint(): string {
  const version = process.env.META_GRAPH_VERSION?.trim() || "v23.0";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
}

/**
 * Send a plain text message to one number.
 *
 * Never throws: a bot that crashes on a send failure would leave the inbound
 * webhook looking failed to Meta and earn a redelivery of a message we already
 * acted on. Failures are logged and reported in the result instead.
 *
 * Only works inside Meta's 24-hour customer-service window — that is, when the
 * user messaged us recently. Outside it, Meta rejects free-form text and only
 * an approved template will deliver.
 */
export async function sendText(to: string, body: string): Promise<SendResult> {
  if (!whatsappConfigured()) {
    console.error("[whatsapp] send skipped: WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set");
    return { ok: false, error: "not_configured" };
  }
  try {
    const res = await http<{ messages?: { id?: string }[]; error?: { message?: string; code?: number } }>(
      endpoint(),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN!.trim()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          // No link preview: our links are one-time and previewing them would
          // have Meta's crawler spend the code before the user taps it.
          text: { preview_url: false, body },
        }),
      },
    );
    if (!res.ok) {
      const message = res.json?.error?.message ?? res.text;
      console.error(`[whatsapp] send failed ${res.status}`, clip(String(message)));
      return { ok: false, error: `graph_${res.status}` };
    }
    return { ok: true, messageId: res.json?.messages?.[0]?.id };
  } catch (err) {
    console.error("[whatsapp] send threw", err instanceof Error ? err.message : err);
    return { ok: false, error: "unreachable" };
  }
}

/** Mark the user's message as read, so the chat shows the blue ticks. */
export async function markRead(messageId: string): Promise<void> {
  if (!whatsappConfigured()) return;
  try {
    await http(endpoint(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN!.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
      timeoutMs: 5_000,
    });
  } catch {
    // Cosmetic only — never let it affect the reply.
  }
}
