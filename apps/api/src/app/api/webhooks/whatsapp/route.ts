// apps/api/src/app/api/webhooks/whatsapp/route.ts
//
// Inbound WhatsApp Cloud API messages.
//
// Two things make this different from the other webhook routes here, and both
// are deliberate:
//
// 1. The reply is NOT this response. A WhatsApp reply is a separate Graph POST,
//    so we acknowledge Meta immediately and answer in after(). Meta wants a 200
//    inside ~20 seconds and disables an endpoint that keeps missing it, which
//    the synchronous pattern used by the settlement webhooks would risk.
// 2. We return 200 for anything we deliberately ignore — status callbacks,
//    reactions, unsupported message types. A non-200 earns an endless
//    redelivery of a message we were never going to act on.
//
// Signature is still verified against the raw bytes before any state change,
// exactly like maplerad/tatum/vtung.

import { NextResponse, after } from "next/server";
import { claimWebhookEvent, markProcessed, releaseWebhookEvent } from "@/lib/ngnWebhook";
import { assertFeatureEnabled } from "@/lib/features";
import { notifyUser } from "@/lib/alerts";
import { prisma } from "@cheqpay/db";
import { markRead, sendText } from "@/lib/whatsapp/client";
import { handleMessage, type Reply } from "@/lib/whatsapp/router";
import { maskNumber } from "@/lib/whatsapp/session";
import { SIGNATURE_HEADER, verifySubscription, verifyWhatsappSignature } from "@/lib/whatsapp/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "whatsapp";

/** Meta's one-off subscription handshake. */
export async function GET(req: Request): Promise<Response> {
  const challenge = verifySubscription(new URL(req.url));
  if (!challenge) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  if (!verifyWhatsappSignature(rawBody, req.headers.get(SIGNATURE_HEADER))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: WhatsappEvent;
  try {
    event = JSON.parse(rawBody) as WhatsappEvent;
  } catch {
    // Signed but unparseable: nothing to retry into.
    return NextResponse.json({ status: "ignored", reason: "invalid json" });
  }

  const inbound = extractTextMessages(event);
  if (!inbound.length) {
    // Delivery receipts, read receipts, reactions, media we don't handle.
    return NextResponse.json({ status: "ignored", reason: "no text message" });
  }

  // The flag is checked after the signature so a disabled bot still answers
  // Meta with a 200 and keeps the subscription healthy.
  try {
    await assertFeatureEnabled("whatsapp_bot");
  } catch {
    return NextResponse.json({ status: "ignored", reason: "feature disabled" });
  }

  // Claim before acknowledging: Meta redelivers aggressively, and a duplicate
  // must not produce a second reply (or a second link).
  const fresh: typeof inbound = [];
  for (const msg of inbound) {
    if (await claimWebhookEvent(SOURCE, msg.messageId, event as unknown as Record<string, unknown>)) {
      fresh.push(msg);
    }
  }
  if (!fresh.length) return NextResponse.json({ status: "duplicate" });

  // Answer after responding. Work that throws here must never reach Meta as a
  // failure: the message is already claimed, and a redelivery would re-run it.
  after(async () => {
    for (const msg of fresh) {
      try {
        void markRead(msg.messageId);
        const reply = await handleMessage(msg);
        if (reply) {
          await sendText(msg.waId, reply.text);
          if (reply.securityEvent) await alertOnLinkChange(reply.securityEvent, msg.waId);
        }
        await markProcessed(SOURCE, msg.messageId);
      } catch (err) {
        console.error("[whatsapp webhook] handling failed", err);
        await releaseWebhookEvent(SOURCE, msg.messageId).catch(() => undefined);
        await sendText(msg.waId, "Something went wrong on our end. Please try again in a moment.").catch(
          () => undefined,
        );
      }
    }
  });

  return NextResponse.json({ status: "accepted", messages: fresh.length });
}

/**
 * Connecting or disconnecting WhatsApp is an account-security change, so it is
 * announced on the channels the user already trusts. A silent takeover is the
 * thing worth making loud.
 */
async function alertOnLinkChange(
  ev: NonNullable<Reply["securityEvent"]>,
  waId: string,
): Promise<void> {
  const linked = ev.kind === "linked";
  await prisma.auditLog
    .create({
      data: {
        userId: ev.userId,
        action: linked ? "whatsapp.linked" : "whatsapp.unlinked",
        resourceType: "WhatsappLink",
        resourceId: maskNumber(waId),
        details: {},
      },
    })
    .catch(() => undefined);
  await notifyUser(ev.userId, {
    title: linked ? "WhatsApp connected" : "WhatsApp disconnected",
    body: linked
      ? `${maskNumber(waId)} can now check your CheqPay balance and history. If this wasn't you, disconnect it in Settings → Security.`
      : `${maskNumber(waId)} can no longer see your CheqPay account.`,
    category: "security",
  }).catch(() => undefined);
}

// --- Meta's payload shape (only the parts we read) ---

interface WhatsappEvent {
  entry?: {
    changes?: {
      value?: {
        messages?: {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
        }[];
      };
    }[];
  }[];
}

/** Every plain-text message in the delivery. Meta can batch several. */
function extractTextMessages(event: WhatsappEvent): { waId: string; text: string; messageId: string }[] {
  const out: { waId: string; text: string; messageId: string }[] = [];
  for (const entry of event.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text") continue;
        const text = message.text?.body;
        if (!message.id || !message.from || !text) continue;
        out.push({ waId: message.from, text, messageId: message.id });
      }
    }
  }
  return out;
}
