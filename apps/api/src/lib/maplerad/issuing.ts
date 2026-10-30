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
import type { Minor } from "./types";

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

/**
 * One issuing webhook, whatever shape it arrived in. Maplerad sends two
 * (https://maplerad.dev/docs/issuing):
 *
 * - `issuing.created.successful` (and the other issuing.* events) is flat:
 *   `{ event, reference, card: { id, masked_pan, issuer, ... } }`.
 * - `issuing.created.failed` is wrapped:
 *   `{ eventId, eventType, payload: { event, reference, status, reason, verification_link, link_expire_at } }`.
 *
 * The older `{ event, data: { reference, card_id, status } }` shape is still
 * read, in case some deliveries use it.
 */
export interface NormalizedIssuingEvent {
  name: string; // e.g. "issuing.created.successful", "" if unknown
  reference?: string; // card-creation reference (created.* only)
  cardId?: string;
  status?: string; // "SUCCESS" | "FAILED" for created.*; raw otherwise
  maskedPan?: string;
  brand?: string;
  reason?: string;
  verificationLink?: string;
  linkExpiresAt?: string;
  raw: Record<string, unknown>; // the unwrapped body
}

const CREATED_OK = "issuing.created.successful";
const CREATED_FAILED = "issuing.created.failed";

function bag(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Read an issuing webhook in any of its shapes. Pure; never throws. */
export function normalizeIssuingEvent(input: unknown): NormalizedIssuingEvent {
  const root = bag(input) ?? {};
  const body = bag(root.payload) ?? root;
  const data = bag(root.data);
  const card = bag(body.card);

  const name =
    text(root.event) ?? text(root.type) ?? text(root.eventType) ?? text(body.event) ?? "";

  // The status comes from the event name. The success payload's card.status is
  // "ACTIVE" and the failure's status is "Rejected"; they stay in `raw`.
  const status =
    name === CREATED_OK
      ? "SUCCESS"
      : name === CREATED_FAILED
        ? "FAILED"
        : text(data?.status) ?? text(body.status);

  return {
    name,
    reference: text(data?.reference) ?? text(body.reference),
    cardId: text(data?.card_id) ?? text(card?.id) ?? text(body.card_id),
    status,
    maskedPan: text(card?.masked_pan) ?? text(data?.masked_pan),
    brand: text(card?.issuer) ?? text(data?.brand),
    reason: text(body.reason),
    verificationLink: text(body.verification_link),
    linkExpiresAt: text(body.link_expire_at),
    raw: body,
  };
}

export interface IssuingOutcome {
  action: "finalized" | "ignored";
  reason?: string;
}

/**
 * Route an issuing webhook to the card store. Only card creation settles a
 * card. The other issuing.* events (transaction, terminated, charge,
 * activation) carry a transaction reference, not a creation one, and card
 * spend is read from Maplerad on demand, so they are acknowledged and ignored.
 */
export async function handleIssuingEvent(
  input: unknown,
  store: CardStorePort,
): Promise<IssuingOutcome> {
  const event = normalizeIssuingEvent(input);
  if (event.name !== CREATED_OK && event.name !== CREATED_FAILED) {
    return { action: "ignored", reason: event.name || "unknown_event" };
  }
  if (!event.reference) {
    // This card will never settle on its own: a human has to match it.
    console.error("[maplerad issuing] card creation event without a reference", {
      name: event.name,
      payload: JSON.stringify(input).slice(0, 2000),
    });
    return { action: "ignored", reason: "no_reference" };
  }

  const raw: IssuingEventData = { ...event.raw };
  if (event.maskedPan) raw.masked_pan = event.maskedPan;
  if (event.brand) raw.brand = event.brand;
  if (event.reason) raw.reason = event.reason;
  if (event.verificationLink) raw.verification_link = event.verificationLink;
  if (event.linkExpiresAt) raw.link_expire_at = event.linkExpiresAt;

  await store.finalizeCard({
    reference: event.reference,
    cardId: event.cardId,
    status: event.status ?? "UNKNOWN",
    raw,
  });
  return { action: "finalized" };
}
