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
 * The full detail of one card. `card_number` and `cvv` are the live secrets —
 * they are returned ONLY to the card's owner (see the reveal route) and are
 * masked in every log by the client's redaction. `balance` is in minor units
 * (cents). Accepts the card id OR the creation reference in {id}.
 *
 * GET /issuing/{id}
 */
export interface CardDetail {
  id: string;
  name?: string;
  card_number?: string; // full PAN — sensitive
  masked_pan?: string;
  expiry?: string; // "MM/YY"
  cvv?: string; // sensitive
  status?: string; // "ACTIVE" | "DISABLED" | ...
  type?: string;
  issuer?: string; // "VISA" | "MASTERCARD"
  currency?: string;
  balance?: number; // minor units (cents)
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export async function getCard(
  idOrReference: string,
  opts?: { retries?: number },
): Promise<CardDetail> {
  // `retries` is exposed so the admin reachability probe can try exactly once:
  // if the proxy's failure on /issuing is a slow timeout, the default 3 retries
  // would blow the diagnostic's time budget and hide the real answer. Normal
  // callers omit it and keep the default retry behaviour.
  return mapleradRequest<CardDetail>(
    `/issuing/${encodeURIComponent(idOrReference)}`,
    opts?.retries !== undefined ? { retries: opts.retries } : {},
  );
}

/**
 * Credit a card with `amountMinor` cents. The money is debited from the
 * business's Maplerad balance, so the caller must first debit the user's own
 * USD balance in our ledger. Synchronous: a 200 means the card was funded.
 *
 * POST /issuing/{id}/fund
 */
export async function fundCard(cardId: string, amountMinor: number): Promise<{ id?: string }> {
  return mapleradRequest<{ id?: string }>(`/issuing/${encodeURIComponent(cardId)}/fund`, {
    method: "POST",
    body: { amount: amountMinor },
  });
}

/**
 * Debit a card by `amountMinor` cents, crediting the business's Maplerad
 * balance; the caller then credits the user's own USD balance. Synchronous.
 *
 * POST /issuing/{id}/withdraw
 */
export async function withdrawFromCard(
  cardId: string,
  amountMinor: number,
): Promise<{ id?: string }> {
  return mapleradRequest<{ id?: string }>(`/issuing/${encodeURIComponent(cardId)}/withdraw`, {
    method: "POST",
    body: { amount: amountMinor },
  });
}

/** Freeze a card: no funding or spending until unfrozen. PATCH /issuing/{id}/freeze */
export async function freezeCard(cardId: string): Promise<void> {
  await mapleradRequest(`/issuing/${encodeURIComponent(cardId)}/freeze`, { method: "PATCH" });
}

/** Unfreeze a previously frozen card. PATCH /issuing/{id}/unfreeze */
export async function unfreezeCard(cardId: string): Promise<void> {
  await mapleradRequest(`/issuing/${encodeURIComponent(cardId)}/unfreeze`, { method: "PATCH" });
}

/** One row of a card's own spending history, as Maplerad reports it. */
export interface CardTransaction {
  id: string;
  amount: number; // minor units
  currency?: string;
  description?: string;
  status?: string;
  entry?: string; // "CREDIT" | "DEBIT"
  merchant?: { name?: string; city?: string; country?: string };
  created_at?: string;
  [key: string]: unknown;
}

/**
 * A card's transactions, newest first, as the provider records them — this is
 * the source of truth for card spend, not our ledger (our ledger only tracks
 * the USD moving on and off the card). GET /issuing/{id}/transactions
 */
export async function getCardTransactions(
  cardId: string,
  params?: { page?: number; pageSize?: number },
): Promise<CardTransaction[]> {
  const data = await mapleradRequest<unknown>(
    `/issuing/${encodeURIComponent(cardId)}/transactions`,
    { query: { page: params?.page, page_size: params?.pageSize } },
  );
  return Array.isArray(data) ? (data as CardTransaction[]) : [];
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
