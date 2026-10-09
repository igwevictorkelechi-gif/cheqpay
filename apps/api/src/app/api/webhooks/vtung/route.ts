// apps/api/src/app/api/webhooks/vtung/route.ts
//
// vtu.ng order updates: a bill that was still processing when we bought it
// completes (or is refunded) here. Signed with HMAC-SHA256 of the body keyed by
// the account PIN, in X-Signature.
//
// The bill row is found by request_id — ours, set to the ledger transaction id
// and stored as its externalRef — and settled through the same idempotent path
// every other bill settlement uses.

import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { claimWebhookEvent, markProcessed, releaseWebhookEvent } from "@/lib/ngnWebhook";
import { settleBillByProviderRef } from "@/lib/billSettlement";
import { mapVtuStatus, verifyVtuSignature } from "@/payments/vtung";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "vtung";

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  if (!verifyVtuSignature(rawBody, req.headers.get("x-signature"), getEnv().VTU_NG_PIN)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  // Some deliveries nest the order under `data`.
  const order = (event.data && typeof event.data === "object" ? event.data : event) as Record<string, unknown>;
  const requestId = String(order.request_id ?? event.request_id ?? "");
  const status = String(order.status ?? event.status ?? "");
  if (!requestId) return NextResponse.json({ status: "ignored", reason: "no request_id" });

  const eventId = `${requestId}:${status || "unknown"}`;
  let claimed = false;
  try {
    if (!(await claimWebhookEvent(SOURCE, eventId, event))) {
      return NextResponse.json({ status: "duplicate" });
    }
    claimed = true;
    const tokenRaw = order.token ?? order.Token ?? order.purchased_code;
    const result = await settleBillByProviderRef(requestId, mapVtuStatus(status), {
      token: typeof tokenRaw === "string" ? tokenRaw : null,
    });
    if (result.outcome === "unmatched") {
      console.error("[vtung webhook] no bill for request_id", { requestId, status });
    }
    await markProcessed(SOURCE, eventId);
    return NextResponse.json({ ...result });
  } catch (err) {
    console.error("[vtung webhook] failed", err);
    if (claimed) await releaseWebhookEvent(SOURCE, eventId);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
