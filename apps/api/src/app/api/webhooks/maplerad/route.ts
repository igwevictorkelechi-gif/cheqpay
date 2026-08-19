// apps/api/src/app/api/webhooks/maplerad/route.ts
//
// Maplerad's webhook endpoint — how a payout learns its fate. We read the raw
// body FIRST and verify the Svix signature against it before parsing: App Router
// handlers don't pre-parse the body, so `req.text()` gives us the exact bytes
// Maplerad signed, and any re-serialization would break the signature.
//
// This settles PAYOUTS (transfer.*) and DEPOSITS (collection.*). A deposit that
// cannot be matched to an owner is logged as an error rather than credited to a
// guess — real money arrived, and placing it on the wrong account is worse than
// leaving it for a human.

import { NextResponse } from "next/server";
import { readSvixHeaders, verifyWebhook } from "@/lib/maplerad/webhooks";
import {
  claimWebhookEvent,
  finalizeWithdrawal,
  markProcessed,
  notifySettlement,
} from "@/lib/ngnWebhook";
import type { CollectionEventData, MapleradWebhookEvent } from "@/lib/maplerad/types";
import { handleIssuingEvent, type IssuingEventData } from "@/lib/maplerad/issuing";
import { handleCollectionEvent } from "@/lib/maplerad/deposits";
import { prismaLedgerPort } from "@/lib/mapleradCollections";
import { cardStore } from "@/lib/cards";

// Node.js runtime: we need crypto + the raw body. Never the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "maplerad";

/** Maplerad payout states -> the three states our ledger settles on. */
function payoutStatus(event: string, raw?: string): "successful" | "failed" | "pending" {
  const s = (raw ?? "").toUpperCase();
  if (event.endsWith(".failed") || s === "FAILED" || s === "DECLINED") return "failed";
  if (event.endsWith(".successful") || s === "SUCCESS" || s === "SUCCESSFUL") {
    return "successful";
  }
  return "pending";
}

interface TransferEventData {
  id?: string;
  reference?: string;
  status?: string;
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  const svix = readSvixHeaders(req.headers);
  if (!svix) {
    return NextResponse.json({ error: "missing signature headers" }, { status: 400 });
  }
  if (!verifyWebhook(rawBody, svix)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: MapleradWebhookEvent<TransferEventData>;
  try {
    event = JSON.parse(rawBody) as MapleradWebhookEvent<TransferEventData>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = event.event ?? event.type ?? "";

  try {
    // Idempotency: svix-id is unique per delivery, so a retried delivery is a
    // no-op rather than a second credit/reversal.
    if (!(await claimWebhookEvent(SOURCE, svix.id, event))) {
      return NextResponse.json({ status: "duplicate", eventId: svix.id });
    }

    if (name.startsWith("transfer.")) {
      // We set `reference` to our transaction id when initiating the payout.
      const reference = event.data?.reference ?? event.reference;
      if (!reference) {
        console.warn("[maplerad webhook] transfer event without a reference", {
          id: svix.id,
          name,
        });
        await markProcessed(SOURCE, svix.id);
        return NextResponse.json({ status: "ignored", reason: "no_reference" });
      }

      const result = await finalizeWithdrawal(
        reference,
        payoutStatus(name, event.data?.status)
      );
      await markProcessed(SOURCE, svix.id);
      await notifySettlement(result);
      return NextResponse.json({ ...result, eventId: svix.id });
    }

    if (name.startsWith("collection.")) {
      // Someone paid into a user's dedicated NUBAN. Credit the owner.
      const outcome = await handleCollectionEvent(
        event as unknown as MapleradWebhookEvent<CollectionEventData>,
        prismaLedgerPort
      );

      if (outcome.outcome === "unmatched") {
        // Real money arrived that we could not place. Never silent: this needs
        // a human, and the payer is owed either a credit or a refund.
        console.error("[maplerad webhook] COLLECTION UNMATCHED — money received, no owner found", {
          id: svix.id,
          name,
          amount: outcome.amount,
          payload: JSON.stringify(event.data).slice(0, 2000),
        });
      }

      await markProcessed(SOURCE, svix.id);
      return NextResponse.json({ ...outcome, eventId: svix.id });
    }

    if (name.startsWith("issuing.")) {
      // Card issuing is async: reconcile the pending card (matched by the
      // creation reference) to active/failed. Safe to run even while
      // virtual_cards is OFF — it only updates a card the user already requested.
      await handleIssuingEvent(
        event as unknown as MapleradWebhookEvent<IssuingEventData>,
        cardStore
      );
      await markProcessed(SOURCE, svix.id);
      return NextResponse.json({ status: "processed", eventId: svix.id });
    }

    if (name.startsWith("crypto.")) {
      // Stablecoin deposit/transfer events. Their exact names and payloads
      // cannot be confirmed yet — Maplerad's sandbox address endpoint is broken
      // (their SQL bug), so no test deposit has ever been observed. Log the
      // full shape loudly; crediting gets wired from a real captured event, not
      // a guess. crypto_deposits stays OFF until then, so nothing is lost.
      console.error("[maplerad webhook] crypto event received but crediting is not wired", {
        id: svix.id,
        name,
        payload: JSON.stringify(event).slice(0, 2000),
      });
      await markProcessed(SOURCE, svix.id);
      return NextResponse.json({ status: "unhandled", eventId: svix.id });
    }

    // Authentic but not an event we consume — acknowledge so Maplerad stops retrying.
    await markProcessed(SOURCE, svix.id);
    return NextResponse.json({ status: "ignored", eventId: svix.id });
  } catch (err) {
    // 500 so Maplerad retries the delivery.
    console.error("[maplerad webhook] handler error", { id: svix.id, name, err });
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}
