// apps/api/src/app/api/webhooks/maplerad/route.ts
//
// Raw-body webhook endpoint for Maplerad (Next.js App Router).
// We read the raw text FIRST and verify the Svix signature against it before
// parsing — App Router route handlers don't pre-parse the body, so `req.text()`
// gives us the exact bytes Maplerad signed.

import { NextResponse } from "next/server";
import {
  readSvixHeaders,
  verifyWebhook,
  routeWebhookEvent,
} from "@/lib/maplerad/webhooks";
import { handleCollectionEvent } from "@/lib/maplerad/deposits";
import type {
  CollectionEventData,
  MapleradWebhookEvent,
} from "@/lib/maplerad/types";
// Implement LedgerPort against your DB (Prisma/Supabase) and export it here.
// e.g. import { mapleradLedger } from "@/lib/maplerad/ledger";

// Ensure Node.js runtime (crypto + raw body), never the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  const svix = readSvixHeaders(req.headers);
  if (!svix) {
    return NextResponse.json({ error: "missing signature headers" }, { status: 400 });
  }

  if (!verifyWebhook(rawBody, svix)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: MapleradWebhookEvent;
  try {
    event = JSON.parse(rawBody) as MapleradWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Idempotency: use svix.id as the dedupe key so retried deliveries are no-ops.
  // TODO(phase-2): persist svix.id and short-circuit if already processed.

  try {
    await routeWebhookEvent(event, {
      // Deposit into a customer virtual account -> credit Cheqpay ledger.
      // Confirm the exact event name against a sandbox webhook and add any
      // aliases Maplerad uses (e.g. "collection.success").
      "collection.successful": async (e) => {
        const result = await handleCollectionEvent(
          e as MapleradWebhookEvent<CollectionEventData>,
          // mapleradLedger, // <- inject your LedgerPort implementation
          throwUntilLedgerWired(),
        );
        if (result.outcome === "unmatched") {
          console.warn("maplerad deposit unmatched", { id: svix.id, result });
        }
      },
      // Card issuing result (async). Wire a CardStorePort (see issuing.ts).
      // "issuing.created": async (e) =>
      //   handleIssuingEvent(e as MapleradWebhookEvent<IssuingEventData>, cardStore),

      // Payout settlement. On success mark the payout settled; on failure
      // reverse the user-side hold/debit in your ledger. Idempotent by tx id.
      // "transfer.successful": async (e) => markPayoutSettled(e),
      // "transfer.failed":     async (e) => reversePayout(e),
    });
  } catch (err) {
    // Return 500 so Maplerad retries; log for investigation.
    console.error("maplerad webhook handler error", { id: svix.id, err });
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

// Remove this once you inject a real LedgerPort above. It exists so the route
// fails loudly (rather than silently dropping deposits) until wiring is done.
function throwUntilLedgerWired(): never {
  throw new Error(
    "Maplerad LedgerPort not wired: implement LedgerPort and pass it to handleCollectionEvent",
  );
}
