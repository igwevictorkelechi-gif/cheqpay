// apps/api/src/lib/eventsAdmin.ts
//
// Admin side of ticketing: event + tier CRUD, the attendee list, per-event
// sales, and gate check-in. Kept apart from lib/events.ts so the customer path
// never imports the admin mutations.

import { Asset, TicketStatus, prisma } from "@cheqpay/db";
import { ApiError } from "./http";
import { toMinorUnits, formatNairaMinor } from "./money";
import { ensureEventsSchema } from "./ensureEvents";

function priceToMinor(price: string): bigint {
  const minor = toMinorUnits(price, Asset.NGN);
  if (minor <= 0n) throw new ApiError(422, "Price must be greater than zero.", "bad_price");
  return minor;
}

function cleanCapacity(capacity: number | null | undefined): number | null {
  if (capacity === null || capacity === undefined) return null;
  const n = Math.trunc(capacity);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(422, "Capacity can’t be negative.", "bad_capacity");
  return n;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new ApiError(422, "Invalid date.", "bad_date");
  return d;
}

// ---- Views ----------------------------------------------------------------

export interface AdminTierView {
  id: string;
  name: string;
  priceMinor: string;
  priceFormatted: string;
  capacity: number | null;
  sold: number;
  active: boolean;
  sortOrder: number;
}

export interface AdminEventView {
  id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  imageUrl: string | null;
  startsAt: string | null;
  active: boolean;
  tiers: AdminTierView[];
  soldCount: number;
  revenueFormatted: string;
  createdAt: string;
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

function toTierView(t: TierRow): AdminTierView {
  return {
    id: t.id,
    name: t.name,
    priceMinor: t.priceMinor.toString(),
    priceFormatted: formatNairaMinor(t.priceMinor),
    capacity: t.capacity,
    sold: t.sold,
    active: t.active,
    sortOrder: t.sortOrder,
  };
}

function eventView(
  e: {
    id: string;
    title: string;
    description: string;
    venue: string;
    city: string;
    imageUrl: string | null;
    startsAt: Date | null;
    active: boolean;
    createdAt: Date;
    tiers: TierRow[];
  },
  revenueMinor: bigint,
): AdminEventView {
  const tiers = [...e.tiers].sort((a, b) => a.sortOrder - b.sortOrder).map(toTierView);
  const soldCount = e.tiers.reduce((n, t) => n + t.sold, 0);
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
    soldCount,
    revenueFormatted: formatNairaMinor(revenueMinor),
    createdAt: e.createdAt.toISOString(),
  };
}

/** Revenue (PAID orders) per event id, in one grouped query. */
async function revenueByEvent(eventIds: string[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (eventIds.length === 0) return out;
  const rows = await prisma.ticketOrder.groupBy({
    by: ["eventId"],
    where: { eventId: { in: eventIds }, status: "PAID" },
    _sum: { totalMinor: true },
  });
  for (const r of rows) out.set(r.eventId, r._sum.totalMinor ?? 0n);
  return out;
}

// ---- Event + tier CRUD ----------------------------------------------------

export async function listAllEvents(): Promise<AdminEventView[]> {
  await ensureEventsSchema();
  const rows = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: { tiers: true },
  });
  const revenue = await revenueByEvent(rows.map((e) => e.id));
  return rows.map((e) => eventView(e, revenue.get(e.id) ?? 0n));
}

export async function getEventDetail(id: string): Promise<AdminEventView> {
  await ensureEventsSchema();
  const e = await prisma.event.findUnique({ where: { id }, include: { tiers: true } });
  if (!e) throw new ApiError(404, "Event not found.", "event_not_found");
  const revenue = await revenueByEvent([id]);
  return eventView(e, revenue.get(id) ?? 0n);
}

export interface EventInput {
  title: string;
  description?: string;
  venue?: string;
  city?: string;
  imageUrl?: string | null;
  startsAt?: string | null;
  active?: boolean;
}

export async function createEvent(input: EventInput): Promise<AdminEventView> {
  await ensureEventsSchema();
  if (!input.title?.trim()) throw new ApiError(422, "A title is required.", "no_title");
  const e = await prisma.event.create({
    data: {
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      venue: input.venue?.trim() ?? "",
      city: input.city?.trim() ?? "",
      imageUrl: input.imageUrl?.trim() || null,
      startsAt: parseDate(input.startsAt),
      active: input.active ?? true,
    },
    include: { tiers: true },
  });
  return eventView(e, 0n);
}

export async function updateEvent(id: string, patch: Partial<EventInput>): Promise<AdminEventView> {
  await ensureEventsSchema();
  const exists = await prisma.event.findUnique({ where: { id } });
  if (!exists) throw new ApiError(404, "Event not found.", "event_not_found");
  await prisma.event.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.venue !== undefined ? { venue: patch.venue.trim() } : {}),
      ...(patch.city !== undefined ? { city: patch.city.trim() } : {}),
      ...(patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl?.trim() || null } : {}),
      ...(patch.startsAt !== undefined ? { startsAt: parseDate(patch.startsAt) } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      updatedAt: new Date(),
    },
  });
  return getEventDetail(id);
}

export async function deactivateEvent(id: string): Promise<AdminEventView> {
  return updateEvent(id, { active: false });
}

export interface TierInput {
  name: string;
  price: string;
  capacity?: number | null;
  active?: boolean;
  sortOrder?: number;
}

export async function createTier(eventId: string, input: TierInput): Promise<AdminEventView> {
  await ensureEventsSchema();
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new ApiError(404, "Event not found.", "event_not_found");
  if (!input.name?.trim()) throw new ApiError(422, "A tier name is required.", "no_name");
  await prisma.ticketTier.create({
    data: {
      eventId,
      name: input.name.trim(),
      priceMinor: priceToMinor(input.price),
      capacity: cleanCapacity(input.capacity),
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return getEventDetail(eventId);
}

export async function updateTier(tierId: string, patch: Partial<TierInput>): Promise<AdminEventView> {
  await ensureEventsSchema();
  const tier = await prisma.ticketTier.findUnique({ where: { id: tierId } });
  if (!tier) throw new ApiError(404, "Tier not found.", "tier_not_found");
  await prisma.ticketTier.update({
    where: { id: tierId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.price !== undefined ? { priceMinor: priceToMinor(patch.price) } : {}),
      ...(patch.capacity !== undefined ? { capacity: cleanCapacity(patch.capacity) } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      updatedAt: new Date(),
    },
  });
  return getEventDetail(tier.eventId);
}

/** Hard-delete a tier only if nothing sold; otherwise deactivate it. */
export async function removeTier(tierId: string): Promise<AdminEventView> {
  await ensureEventsSchema();
  const tier = await prisma.ticketTier.findUnique({ where: { id: tierId } });
  if (!tier) throw new ApiError(404, "Tier not found.", "tier_not_found");
  if (tier.sold > 0) {
    await prisma.ticketTier.update({ where: { id: tierId }, data: { active: false } });
  } else {
    await prisma.ticketTier.delete({ where: { id: tierId } });
  }
  return getEventDetail(tier.eventId);
}

// ---- Attendees + check-in -------------------------------------------------

export interface AttendeeView {
  id: string;
  reference: string;
  tierName: string;
  status: TicketStatus;
  holderEmail: string | null;
  usedAt: string | null;
  createdAt: string;
}

export async function listEventTickets(eventId: string): Promise<AttendeeView[]> {
  await ensureEventsSchema();
  const rows = await prisma.ticket.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    reference: t.reference,
    tierName: t.tierName,
    status: t.status,
    holderEmail: t.user?.email ?? null,
    usedAt: t.usedAt ? t.usedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  }));
}

export interface CheckInResult {
  reference: string;
  eventTitle: string;
  tierName: string;
  status: TicketStatus;
  checkedInAt: string;
}

/**
 * Check a ticket in at the gate. Idempotent-guarded: the update only fires on a
 * ticket that is still VALID, so a second scan of the same code reports it as
 * already used rather than admitting twice.
 */
export async function checkInTicket(reference: string, adminId?: string): Promise<CheckInResult> {
  await ensureEventsSchema();
  const ref = reference.trim().toUpperCase();
  if (!ref) throw new ApiError(422, "Enter a ticket reference.", "no_reference");

  const ticket = await prisma.ticket.findUnique({ where: { reference: ref } });
  if (!ticket) throw new ApiError(404, "No ticket with that reference.", "invalid_ticket");

  if (ticket.status !== TicketStatus.VALID) {
    const when = ticket.usedAt ? ` (${new Date(ticket.usedAt).toLocaleString("en-NG")})` : "";
    const msg =
      ticket.status === TicketStatus.USED
        ? `Already checked in${when}.`
        : ticket.status === TicketStatus.CANCELLED
          ? "This ticket was cancelled."
          : "This ticket was refunded.";
    throw new ApiError(409, msg, "not_valid");
  }

  const now = new Date();
  const done = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: TicketStatus.VALID },
    data: { status: TicketStatus.USED, usedAt: now, checkedInBy: adminId ?? "admin" },
  });
  if (done.count !== 1) {
    throw new ApiError(409, "Already checked in.", "not_valid");
  }

  return {
    reference: ref,
    eventTitle: ticket.eventTitle,
    tierName: ticket.tierName,
    status: TicketStatus.USED,
    checkedInAt: now.toISOString(),
  };
}
