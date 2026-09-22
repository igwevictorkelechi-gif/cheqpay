// apps/api/src/app/api/webhooks/tatum/route.ts
//
// Tatum's notification endpoint — the automatic, instant crypto deposit path.
//
// The raw body is read FIRST and the HMAC verified against those exact bytes:
// App Router does not pre-parse, and any re-serialization would break the
// digest. Only then is it parsed.
//
// A deposit we cannot place is logged in full and left for a human. Real money
// arrived; putting it on a guessed account is worse than leaving it.

import { NextResponse } from "next/server";
import { claimWebhookEvent, markProcessed, releaseWebhookEvent } from "@/lib/ngnWebhook";
import { readPayloadHash, tatumWebhookSecret, verifyTatumSignature } from "@/lib/tatum/webhook";
import { creditTatumDeposit, parseTatumDeposit } from "@/lib/tatum/deposits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "tatum";

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  // Without a configured secret we cannot tell Tatum from anyone else, and this
  // endpoint mints balance. Refuse rather than credit on trust.
  if (!tatumWebhookSecret()) {
    console.error("[tatum webhook] TATUM_WEBHOOK_SECRET is not set — refusing delivery");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const digest = readPayloadHash(req.headers);
  if (!digest) {
    return NextResponse.json({ error: "missing x-payload-hash" }, { status: 400 });
  }
  if (!verifyTatumSignature(rawBody, digest)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = parseTatumDeposit(event);
  if (!parsed) {
    // Log the whole payload: it is the only record of a deposit we may owe
    // someone, and it is what the parser gets taught from.
    console.error("[tatum webhook] unparseable notification", {
      payload: JSON.stringify(event).slice(0, 4000),
    });
    return NextResponse.json({ status: "unparseable" });
  }

  // Set once the claim exists, so a failure below can hand it back.
  let claimedEventId: string | null = null;

  try {
    // One delivery per transfer. A Tatum retry repeats the same fields, so this
    // short-circuits before any balance work; creditBalance is idempotent too,
    // making this belt and braces rather than the only guard.
    const eventId = `${parsed.txId}:${parsed.address.toLowerCase()}:${parsed.amount}`;
    if (!(await claimWebhookEvent(SOURCE, eventId, event))) {
      return NextResponse.json({ status: "duplicate", eventId });
    }
    claimedEventId = eventId;

    const outcome = await creditTatumDeposit(parsed);

    if (outcome.outcome === "unmatched") {
      console.error("[tatum webhook] UNMATCHED — deposit received, no owner found", {
        reason: outcome.reason,
        address: parsed.address,
        network: parsed.network,
        txId: parsed.txId,
        payload: JSON.stringify(event).slice(0, 4000),
      });
    } else if (outcome.outcome === "ignored") {
      // Most often an unknown token contract — i.e. someone sent a coin we do
      // not carry, or a worthless look-alike token. Worth seeing, not alarming.
      console.warn("[tatum webhook] ignored", { reason: outcome.reason, txId: parsed.txId });
    }

    await markProcessed(SOURCE, eventId);
    return NextResponse.json({ ...outcome, eventId });
  } catch (err) {
    // 500 so Tatum retries rather than us acknowledging a deposit we dropped —
    // and hand the claim back, or that retry would dedupe against a delivery we
    // never actually finished.
    if (claimedEventId) await releaseWebhookEvent(SOURCE, claimedEventId);
    console.error("[tatum webhook] handler error", { txId: parsed.txId, err });
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}
