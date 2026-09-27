// apps/api/src/lib/events.ts
//
// Event ticketing: the business curates events (concerts, shows) with priced
// tiers, and users buy tickets paid from their NGN balance. Like the gadget
// store there is no third-party provider, so a purchase is a purely internal
// money move that settles in one guarded transaction.
//
// Money safety mirrors the gadget store:
//   - the tier price is read from the database on the server, never trusted
//     from the client;
//   - the debit, the per-tier capacity decrement, the order and the ledger row
//     settle in ONE transaction with a balance floor and a capacity floor, so a
//     tier can never oversell and a user can never be charged without tickets;
//   - it is idempotent on the caller's Idempotency-Key.
//
// Each seat is its own Ticket row with a unique, unguessable reference encoded
// in a QR the holder shows at the gate; check-in flips it to USED (see
// eventsAdmin.checkInTicket) so it cannot be reused.

import { randomBytes } from "node:crypto";
import { Asset, TicketStatus, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { ApiError } from "./http";
import { formatNairaMinor } from "./money";
import { ensureEventsSchema } from "./ensureEvents";
import { ensureTicketTxnType } from "./ensureTicketTxnType";
import { notifyUser } from "./alerts";

/** Sanity ceiling on one order — a storefront, not a wholesaler. */
const MAX_QUANTITY = 10;

/**
 * Free tickets cost nothing to grab, so one person could otherwise empty a
 * free event's capacity. Cap what one account holds per free tier.
 */
const MAX_FREE_PER_USER = 4;

/** What a price shows as: "Free" for ₦0, otherwise naira. */
function priceLabel(minor: bigint): string {
  return minor === 0n ? "Free" : formatNairaMinor(minor);
}

// Crockford base32 (no I/L/O/U) so a reference is easy to read aloud and type.
const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function makeReference(): string {
  const b = randomBytes(10);
  let s = "";
  for (let i = 0; i < b.length; i++) s += REF_ALPHABET[b[i] % 32];
  return `CHQ-${s.slice(0, 5)}-${s.slice(5, 10)}`;
}

// ---- Views ----------------------------------------------------------------

export interface TierView {
  id: string;
  name: string;
  priceMinor: string;
  priceFormatted: string;
  /** A ₦0 tier: claimed without a PIN and without touching the balance. */
  free: boolean;
  /** null when unlimited; otherwise units left. */
  remaining: number | null;
  available: boolean;
}

export interface EventView {
  id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  category: string;
  imageUrl: string | null;
  startsAt: string | null;
  active: boolean;
  tiers: TierView[];
  /** Lowest available tier price, for the card. null when nothing is sellable. */
  fromPriceFormatted: string | null;
  /** Has at least one free tier that can still be claimed. */
  free: boolean;
}

interface TierRow {
  id: string;
  name: string;
  priceMinor: bigint;
  capacity: number | null;
  sold: number;
  active: boolean;
  sortOrder: number;
}

function toTierView(t: TierRow): TierView {
  const remaining = t.capacity === null ? null : Math.max(0, t.capacity - t.sold);
  return {
    id: t.id,
    name: t.name,
    priceMinor: t.priceMinor.toString(),
    priceFormatted: priceLabel(t.priceMinor),
    free: t.priceMinor === 0n,
    remaining,
    available: t.active && (remaining === null || remaining > 0),
  };
}

/** The categories an event can be listed under. Admins pick one per event. */
export const EVENT_CATEGORIES = [
  "Music",
  "Comedy",
  "Nightlife",
  "Sports",
  "Conference",
  "Arts & Theatre",
  "Festival",
  "Faith",
  "Food & Drink",
  "Other",
] as const;

function toEventView(e: {
  id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  category: string;
  imageUrl: string | null;
  startsAt: Date | null;
  active: boolean;
  tiers?: TierRow[];
}): EventView {
  const tiers = (e.tiers ?? []).map(toTierView);
  const sellable = tiers.filter((t) => t.available).map((t) => BigInt(t.priceMinor));
  const from = sellable.length ? sellable.reduce((a, b) => (b < a ? b : a)) : null;
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    venue: e.venue,
    city: e.city,
    category: e.category,
    imageUrl: e.imageUrl,
    startsAt: e.startsAt ? e.startsAt.toISOString() : null,
    active: e.active,
    tiers,
    fromPriceFormatted: from === null ? null : priceLabel(from),
    free: from === 0n,
  };
}

export interface TicketView {
  id: string;
  reference: string;
  eventId: string;
  eventTitle: string;
  tierName: string;
  priceFormatted: string;
  status: TicketStatus;
  venue: string | null;
  startsAt: string | null;
  createdAt: string;
}

// ---- Catalog reads --------------------------------------------------------

export interface EventFilters {
  /** Free text, matched against title, venue, city and description. */
  q?: string;
  city?: string;
  category?: string;
  /** Only events with a free ticket that can still be claimed. */
  free?: boolean;
}

/**
 * The storefront: active events (with their active tiers), soonest first,
 * narrowed by search text, city and category. Matching ignores case.
 */
export async function listActiveEvents(filters: EventFilters = {}): Promise<EventView[]> {
  await ensureEventsSchema();
  const q = filters.q?.trim().slice(0, 100);
  const city = filters.city?.trim().slice(0, 120);
  const category = filters.category?.trim().slice(0, 60);
  const rows = await prisma.event.findMany({
    where: {
      active: true,
      ...(city ? { city: { equals: city, mode: "insensitive" as const } } : {}),
      ...(category ? { category: { equals: category, mode: "insensitive" as const } } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { venue: { contains: q, mode: "insensitive" as const } },
              { city: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
    include: { tiers: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  const events = rows.map((e) => toEventView(e));
  return filters.free ? events.filter((e) => e.free) : events;
}

/** The cities and categories that currently have events, for the filter chips. */
export async function listEventFacets(): Promise<{ cities: string[]; categories: string[]; hasFree: boolean }> {
  await ensureEventsSchema();
  const rows = await prisma.event.findMany({
    where: { active: true },
    select: { city: true, category: true },
  });
  const freeTier = await prisma.ticketTier.findFirst({
    where: { active: true, priceMinor: 0n, event: { active: true } },
    select: { id: true, capacity: true, sold: true },
  });
  // One entry per name whatever its case, keeping the first spelling seen.
  const uniq = (xs: string[]) => {
    const seen = new Map<string, string>();
    for (const x of xs.map((v) => v.trim()).filter(Boolean)) {
      if (!seen.has(x.toLowerCase())) seen.set(x.toLowerCase(), x);
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  };
  const used = new Set(rows.map((r) => r.category.trim().toLowerCase()).filter(Boolean));
  return {
    // Whether to offer the "Free" chip at all. Approximate on capacity (one
    // sold-out free tier hides nothing); the list itself is exact.
    hasFree: !!freeTier,
    cities: uniq(rows.map((r) => r.city)),
    // Keep the curated order, then anything else an older event carries.
    categories: [
      ...EVENT_CATEGORIES.filter((c) => used.has(c.toLowerCase())),
      ...uniq(rows.map((r) => r.category)).filter(
        (c) => !EVENT_CATEGORIES.some((k) => k.toLowerCase() === c.toLowerCase()),
      ),
    ],
  };
}

/** One event for the storefront. Throws 404 if it is not sellable. */
export async function getActiveEvent(id: string): Promise<EventView> {
  await ensureEventsSchema();
  const e = await prisma.event.findUnique({
    where: { id },
    include: { tiers: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!e || !e.active) throw new ApiError(404, "That event isn’t available.", "event_not_found");
  return toEventView(e);
}

// ---- Checkout -------------------------------------------------------------

export interface TicketCheckoutInput {
  userId: string;
  eventId: string;
  tierId: string;
  quantity: number;
  idempotencyKey: string;
}

export interface TicketOrderView {
  id: string;
  eventTitle: string;
  tierName: string;
  quantity: number;
  totalFormatted: string;
  totalMinor: string;
  tickets: { id: string; reference: string; status: TicketStatus }[];
  createdAt: string;
}

/**
 * Buy tickets. Money-safe and idempotent. Returns the created (or, on replay,
 * the existing) order with its issued tickets.
 *
 * The transaction PIN is checked by the route before this runs.
 */
export async function checkoutTickets(input: TicketCheckoutInput): Promise<TicketOrderView> {
  const qty = Math.trunc(input.quantity);
  if (!Number.isFinite(qty) || qty < 1) {
    throw new ApiError(422, "Choose at least one ticket.", "bad_quantity");
  }
  if (qty > MAX_QUANTITY) {
    throw new ApiError(422, `You can buy at most ${MAX_QUANTITY} tickets at a time.`, "quantity_too_high");
  }

  await ensureEventsSchema();
  await ensureTicketTxnType();

  // Idempotent replay — return the order the first request created.
  const existing = await prisma.transaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) {
    const order = await prisma.ticketOrder.findFirst({
      where: { transactionId: existing.id, userId: input.userId },
      include: { tickets: true },
    });
    if (order) return toOrderView(order);
  }

  // Price + capacity are authoritative from the database.
  const tier = await prisma.ticketTier.findUnique({
    where: { id: input.tierId },
    include: { event: true },
  });
  if (!tier || !tier.active || tier.eventId !== input.eventId) {
    throw new ApiError(404, "That ticket isn’t available.", "tier_not_found");
  }
  if (!tier.event || !tier.event.active) {
    throw new ApiError(404, "That event isn’t available.", "event_not_found");
  }
  if (tier.capacity !== null && tier.sold + qty > tier.capacity) {
    const left = Math.max(0, tier.capacity - tier.sold);
    throw new ApiError(
      409,
      left <= 0 ? "That ticket is sold out." : `Only ${left} left — reduce the quantity.`,
      "sold_out",
    );
  }

  const unitPriceMinor = tier.priceMinor;
  const totalMinor = unitPriceMinor * BigInt(qty);
  const eventTitle = tier.event.title;
  const tierName = tier.name;
  const free = unitPriceMinor === 0n;

  const order = await prisma.$transaction(async (db) => {
    if (free) {
      // Nothing to debit — but one account can't hoard a free event. Counted
      // inside the transaction; the per-user rate limit covers the rest.
      const held = await db.ticket.count({
        where: { userId: input.userId, tierId: tier.id, status: { in: [TicketStatus.VALID, TicketStatus.USED] } },
      });
      if (held + qty > MAX_FREE_PER_USER) {
        const left = Math.max(0, MAX_FREE_PER_USER - held);
        throw new ApiError(
          409,
          left === 0
            ? `You already have the most free tickets allowed for this event (${MAX_FREE_PER_USER}).`
            : `You can claim ${left} more free ticket${left === 1 ? "" : "s"} for this event.`,
          "free_limit",
        );
      }
    } else {
      // Guarded debit: a balance floor means an overdraw changes zero rows.
      const debit = await db.balance.updateMany({
        where: { userId: input.userId, asset: Asset.NGN, available: { gte: totalMinor } },
        data: { available: { decrement: totalMinor } },
      });
      if (debit.count !== 1) {
        throw new ApiError(422, "Insufficient NGN balance", "insufficient_funds");
      }
    }

    // Guarded capacity decrement: a tracked tier must still have room at commit
    // time, closing the race between the check above and here.
    if (tier.capacity !== null) {
      const cap = tier.capacity;
      const dec = await db.ticketTier.updateMany({
        where: { id: tier.id, sold: { lte: cap - qty } },
        data: { sold: { increment: qty } },
      });
      if (dec.count !== 1) {
        throw new ApiError(409, "Those tickets just sold out.", "sold_out");
      }
    } else {
      await db.ticketTier.update({ where: { id: tier.id }, data: { sold: { increment: qty } } });
    }

    const tx = await db.transaction.create({
      data: {
        userId: input.userId,
        type: TransactionType.TICKET_PURCHASE,
        asset: Asset.NGN,
        amount: totalMinor,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: input.idempotencyKey,
        metadata: {
          kind: "ticket",
          eventId: tier.eventId,
          eventTitle,
          tierId: tier.id,
          tierName,
          quantity: qty,
          ...(free ? { free: true } : {}),
        },
      },
    });

    const created = await db.ticketOrder.create({
      data: {
        userId: input.userId,
        eventId: tier.eventId,
        quantity: qty,
        totalMinor,
        status: "PAID",
        transactionId: tx.id,
      },
    });

    const tickets = [];
    for (let i = 0; i < qty; i++) {
      const ticket = await db.ticket.create({
        data: {
          orderId: created.id,
          userId: input.userId,
          eventId: tier.eventId,
          tierId: tier.id,
          eventTitle,
          tierName,
          priceMinor: unitPriceMinor,
          reference: makeReference(),
          status: TicketStatus.VALID,
        },
      });
      tickets.push(ticket);
    }

    await db.auditLog.create({
      data: {
        userId: input.userId,
        action: "ticket.ordered",
        resourceType: "TicketOrder",
        resourceId: created.id,
        details: { eventId: tier.eventId, tierId: tier.id, quantity: qty, totalMinor: totalMinor.toString() },
      },
    });

    return { ...created, tickets };
  });

  const confirmation = free
    ? {
        category: "updates" as const,
        title: qty > 1 ? "Free tickets booked" : "Free ticket booked",
      }
    : {
        category: "withdrawals" as const,
        emailKind: "money_out" as const,
        title: "Tickets booked",
        amount: formatNairaMinor(totalMinor),
      };
  await notifyUser(input.userId, {
    ...confirmation,
    body: `Your ${qty} × ${tierName} ticket${qty > 1 ? "s" : ""} for ${eventTitle} ${qty > 1 ? "are" : "is"} confirmed. Find ${qty > 1 ? "them" : "it"} under My tickets.`,
    data: { orderId: order.id },
    details: [
      { label: "Event", value: eventTitle },
      { label: "Tickets", value: `${qty} × ${tierName}` },
      { label: "Total", value: priceLabel(totalMinor) },
    ],
  }).catch(() => {});

  return toOrderView(order);
}

function toOrderView(o: {
  id: string;
  quantity: number;
  totalMinor: bigint;
  createdAt: Date;
  tickets: { id: string; reference: string; status: TicketStatus; eventTitle: string; tierName: string }[];
}): TicketOrderView {
  const first = o.tickets[0];
  return {
    id: o.id,
    eventTitle: first?.eventTitle ?? "",
    tierName: first?.tierName ?? "",
    quantity: o.quantity,
    totalFormatted: priceLabel(o.totalMinor),
    totalMinor: o.totalMinor.toString(),
    tickets: o.tickets.map((t) => ({ id: t.id, reference: t.reference, status: t.status })),
    createdAt: o.createdAt.toISOString(),
  };
}

// ---- Ticket reads ---------------------------------------------------------

/** The signed-in user's tickets, newest first, enriched with event context. */
export async function listUserTickets(userId: string): Promise<TicketView[]> {
  await ensureEventsSchema();
  const rows = await prisma.ticket.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const eventIds = Array.from(new Set(rows.map((t) => t.eventId)));
  const events = eventIds.length
    ? await prisma.event.findMany({ where: { id: { in: eventIds } } })
    : [];
  const byId = new Map(events.map((e) => [e.id, e]));
  return rows.map((t) => {
    const e = byId.get(t.eventId);
    return {
      id: t.id,
      reference: t.reference,
      eventId: t.eventId,
      eventTitle: t.eventTitle,
      tierName: t.tierName,
      priceFormatted: priceLabel(t.priceMinor),
      status: t.status,
      venue: e ? e.venue : null,
      startsAt: e && e.startsAt ? e.startsAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
    };
  });
}

/**
 * Whether a tier is free, for the route to decide if a PIN is needed. Null
 * when the tier doesn't exist (checkout then reports it properly).
 */
export async function tierIsFree(tierId: string): Promise<boolean | null> {
  await ensureEventsSchema();
  const tier = await prisma.ticketTier.findUnique({ where: { id: tierId }, select: { priceMinor: true } });
  return tier ? tier.priceMinor === 0n : null;
}

export { toEventView, toTierView, MAX_QUANTITY, MAX_FREE_PER_USER };
