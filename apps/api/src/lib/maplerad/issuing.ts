// apps/api/src/lib/maplerad/issuing.ts
//
// Card issuing. Card creation is ASYNCHRONOUS: POST /issuing returns a
// `reference` immediately and the final card (or failure) arrives by webhook.
// Persist the reference as a PENDING card, then reconcile on the issuing
// webhook.
//
// CAVEAT (Open question O2): the public schema exposes USD, VIRTUAL cards only.
// `is_contactless: true` requests a tokenized card (the NFC/tap primitive).
// Cheqpay's tap-to-pay is positioned as NGN — confirm with Maplerad what your
// account tier supports (NGN issuing, physical cards, tap tokenization) before
// building the NFC UX on top of this.

import { mapleradRequest } from "./client";
import type { Minor, MapleradWebhookEvent } from "./types";

export type CardBrand = "VISA" | "MASTERCARD";

export interface CreateCardInput {
  customerId: string;
  currency?: "USD";
  type?: "VIRTUAL";
  brand?: CardBrand; // defaults to VISA
  /** Pre-fund amount in minor units (cents). Available for VISA & MASTERCARD. */
  amount?: Minor;
  /** true for a tokenized (contactless/NFC) card. */
  isContactless?: boolean;
  autoApprove?: boolean; // must be true
}

export interface CardCreationAck {
  reference: string; // reconcile against the issuing webhook
}

/**
 * Create a customer card. Async — returns a reference, final status via webhook.
 * POST /issuing
 */
export async function createCard(input: CreateCardInput): Promise<CardCreationAck> {
  return mapleradRequest<CardCreationAck>("/issuing", {
    method: "POST",
    body: {
      customer_id: input.customerId,
      currency: input.currency ?? "USD",
      type: input.type ?? "VIRTUAL",
      auto_approve: input.autoApprove ?? true,
      brand: input.brand ?? "VISA",
      amount: input.amount,
      is_contactless: input.isContactless ?? false,
    },
  });
}

/**
 * Create a business card (funded from the business wallet).
 * POST /issuing/business  (path inferred — confirm in sandbox)
 */
export async function createBusinessCard(input: {
  currency?: "USD";
  brand?: CardBrand;
  amount?: Minor;
  autoApprove?: boolean;
}): Promise<CardCreationAck> {
  return mapleradRequest<CardCreationAck>("/issuing/business", {
    method: "POST",
    body: {
      currency: input.currency ?? "USD",
      brand: input.brand ?? "VISA",
      amount: input.amount,
      auto_approve: input.autoApprove ?? true,
    },
  });
}

/**
 * List card-declined charges (for support / dashboards).
 * GET /issuing/charges/declined  (path inferred — confirm in sandbox)
 */
export async function getCardDeclines(params?: {
  page?: number;
  pageSize?: number;
}): Promise<unknown[]> {
  return mapleradRequest<unknown[]>("/issuing/charges/declined", {
    query: { page: params?.page, page_size: params?.pageSize },
  });
}

// ---- Webhook finalize -----------------------------------------------------

export interface IssuingEventData {
  reference?: string; // matches createCard() ack
  card_id?: string;
  status?: string; // "SUCCESS" | "FAILED" | ...
  [key: string]: unknown;
}

export interface CardStorePort {
  /** Mark a pending card (by creation reference) as issued or failed. */
  finalizeCard(input: {
    reference: string;
    cardId?: string;
    status: string;
    raw: IssuingEventData;
  }): Promise<void>;
}

/** Route an issuing webhook to your card store. */
export async function handleIssuingEvent(
  event: MapleradWebhookEvent<IssuingEventData>,
  store: CardStorePort,
): Promise<void> {
  const data = event.data;
  const reference = data?.reference;
  if (!reference) return; // nothing to reconcile against
  await store.finalizeCard({
    reference,
    cardId: data.card_id,
    status: data.status ?? "UNKNOWN",
    raw: data,
  });
}
