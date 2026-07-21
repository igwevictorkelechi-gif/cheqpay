import { ApiError } from "@/lib/http";

/**
 * Maplerad virtual-card issuing client.
 *
 * ⚠️ VERIFY BEFORE GOING LIVE ⚠️
 * The Maplerad API reference (maplerad.dev) was not reachable while this was
 * written, so the request/response shapes below are BEST-EFFORT placeholders
 * based on Maplerad's public conventions. Every endpoint, field name and
 * response path marked `// VERIFY` MUST be checked against the live docs
 * before real money or PII flows through it.
 *
 * The whole feature ships DARK: when MAPLERAD_SECRET_KEY is unset, isConfigured()
 * is false and the card routes return 503 "cards_not_configured". No card is
 * ever issued off a guessed money-path shape.
 */

const SECRET = process.env.MAPLERAD_SECRET_KEY ?? "";
const ENV = (process.env.MAPLERAD_ENV ?? "sandbox").toLowerCase();

// VERIFY: base host. Maplerad convention is api.maplerad.com/v1 for live and
// sandbox.api.maplerad.com/v1 for the sandbox.
const BASE =
  ENV === "live"
    ? "https://api.maplerad.com/v1"
    : "https://sandbox.api.maplerad.com/v1";

export function isCardsConfigured(): boolean {
  return SECRET.length > 0;
}

export function assertCardsConfigured(): void {
  if (!isCardsConfigured()) {
    throw new ApiError(
      503,
      "Virtual cards are not available yet.",
      "cards_not_configured"
    );
  }
}

async function mapleradFetch<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" }
): Promise<T> {
  assertCardsConfigured();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(502, "Card provider unreachable", "provider_unreachable");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      "Card provider request failed";
    throw new ApiError(502, message, "provider_error");
  }
  // VERIFY: Maplerad wraps successful payloads as { status, message, data }.
  return (json.data ?? json) as T;
}

export interface MapleradCard {
  id: string;
  currency: string;
  brand?: string;
  maskedPan?: string;
  status?: string;
}

/**
 * VERIFY: create (or reuse) a Maplerad customer for this user. Real onboarding
 * needs full KYC fields (name, email, identity doc); this placeholder sends the
 * minimum and returns the customer id from the response.
 */
export async function ensureMapleradCustomer(input: {
  firstName: string;
  lastName: string;
  email: string;
}): Promise<string> {
  // VERIFY: endpoint POST /customers and the returned id field.
  const data = await mapleradFetch<{ id: string }>("/customers", {
    method: "POST",
    body: {
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
    },
  });
  return data.id;
}

/**
 * VERIFY: issue a USD virtual card for a customer.
 */
export async function issueMapleradCard(input: {
  customerId: string;
  currency?: string;
}): Promise<MapleradCard> {
  // VERIFY: endpoint POST /issuing and the request body / response shape.
  const data = await mapleradFetch<Record<string, unknown>>("/issuing", {
    method: "POST",
    body: {
      customer_id: input.customerId,
      currency: input.currency ?? "USD",
      type: "VIRTUAL",
    },
  });
  return normalizeCard(data);
}

/** VERIFY: fetch one card by provider id (safe metadata only). */
export async function getMapleradCard(providerCardId: string): Promise<MapleradCard> {
  // VERIFY: endpoint GET /issuing/{id}.
  const data = await mapleradFetch<Record<string, unknown>>(
    `/issuing/${providerCardId}`
  );
  return normalizeCard(data);
}

/** VERIFY: freeze / unfreeze a card. */
export async function setMapleradCardFrozen(
  providerCardId: string,
  frozen: boolean
): Promise<void> {
  // VERIFY: endpoint POST /issuing/{id}/freeze | /unfreeze.
  await mapleradFetch(`/issuing/${providerCardId}/${frozen ? "freeze" : "unfreeze"}`, {
    method: "POST",
  });
}

function normalizeCard(data: Record<string, unknown>): MapleradCard {
  // VERIFY: field names (id, currency, brand, masked_pan / last4, status).
  const last4 =
    typeof data.last4 === "string"
      ? data.last4
      : typeof data.masked_pan === "string"
        ? data.masked_pan.slice(-4)
        : undefined;
  return {
    id: String(data.id ?? data.card_id ?? ""),
    currency: typeof data.currency === "string" ? data.currency : "USD",
    brand: typeof data.brand === "string" ? data.brand : undefined,
    maskedPan: last4 ? `•••• ${last4}` : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
  };
}
