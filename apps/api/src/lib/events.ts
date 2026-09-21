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
  imageUrl: string | null;
  startsAt: string | null;
  active: boolean;
  tiers: TierView[];
  /** Lowest available tier price, for the card. null when nothing is sellable. */
  fromPriceFormatted: string | null;
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
    priceFormatted: formatNairaMinor(t.priceMinor),
    remaining,
    available: t.active && (remaining === null || remaining > 0),
  };
}

function toEventView(e: {
  id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
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
    imageUrl: e.imageUrl,
    startsAt: e.startsAt ? e.startsAt.toISOString() : null,
    active: e.active,
    tiers,
    fromPriceFormatted: from === null ? null : formatNairaMinor(from),
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

/** The storefront: active events (with their active tiers), soonest first. */
export async function listActiveEvents(): Promise<EventView[]> {
  await ensureEventsSchema();
  const rows = await prisma.event.findMany({
    where: { active: true },
    orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
    include: { tiers: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  return rows.map((e) => toEventView(e));
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

  const order = await prisma.$transaction(async (db) => {
    // Guarded debit: a balance floor means an overdraw changes zero rows.
    const debit = await db.balance.updateMany({
      where: { userId: input.userId, asset: Asset.NGN, available: { gte: totalMinor } },
      data: { available: { decrement: totalMinor } },
    });
    if (debit.count !== 1) {
      throw new ApiError(422, "Insufficient NGN balance", "insufficient_funds");
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

  await notifyUser(input.userId, {
    category: "withdrawals",
    emailKind: "money_out",
    title: "Tickets booked",
    body: `Your ${qty} × ${tierName} ticket${qty > 1 ? "s" : ""} for ${eventTitle} ${qty > 1 ? "are" : "is"} confirmed. Find ${qty > 1 ? "them" : "it"} under My tickets.`,
    amount: formatNairaMinor(totalMinor),
    data: { orderId: order.id },
    details: [
      { label: "Event", value: eventTitle },
      { label: "Tickets", value: `${qty} × ${tierName}` },
      { label: "Total", value: formatNairaMinor(totalMinor) },
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
    totalFormatted: formatNairaMinor(o.totalMinor),
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
      priceFormatted: formatNairaMinor(t.priceMinor),
      status: t.status,
      venue: e ? e.venue : null,
      startsAt: e && e.startsAt ? e.startsAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
    };
  });
}

export { toEventView, toTierView, MAX_QUANTITY };
