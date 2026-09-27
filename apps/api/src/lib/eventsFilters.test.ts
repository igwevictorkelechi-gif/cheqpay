import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn(), tierFindFirst: vi.fn() }));
vi.mock("@cheqpay/db", () => ({
  Prisma: {},
  TicketStatus: { VALID: "VALID" },
  prisma: { event: { findMany: h.findMany }, ticketTier: { findFirst: h.tierFindFirst } },
}));
vi.mock("./ensureEvents", () => ({ ensureEventsSchema: vi.fn().mockResolvedValue(undefined) }));

import { listActiveEvents, listEventFacets } from "./events";

beforeEach(() => {
  vi.clearAllMocks();
  h.findMany.mockResolvedValue([]);
  h.tierFindFirst.mockResolvedValue(null);
});

describe("event search and filters", () => {
  it("searches title, venue, city and description, ignoring case", async () => {
    await listActiveEvents({ q: "  burna ", city: "Lagos", category: "Music" });
    const where = h.findMany.mock.calls[0][0].where;
    expect(where.active).toBe(true);
    expect(where.city).toEqual({ equals: "Lagos", mode: "insensitive" });
    expect(where.category).toEqual({ equals: "Music", mode: "insensitive" });
    expect(where.OR.map((c: Record<string, unknown>) => Object.keys(c)[0])).toEqual(["title", "venue", "city", "description"]);
    expect(where.OR[0].title).toEqual({ contains: "burna", mode: "insensitive" });
  });

  it("lists everything active when no filter is given", async () => {
    await listActiveEvents();
    expect(h.findMany.mock.calls[0][0].where).toEqual({ active: true });
  });

  it("offers the cities and categories that have events, curated order first", async () => {
    h.findMany.mockResolvedValue([
      { city: "Lagos", category: "Music" },
      { city: "lagos", category: "Comedy" },
      { city: "Abuja", category: "Music" },
      { city: "", category: "" },
    ]);
    await expect(listEventFacets()).resolves.toEqual({ cities: ["Abuja", "Lagos"], categories: ["Music", "Comedy"], hasFree: false });
  });

  it("narrows to events with a free ticket when asked", async () => {
    const tierRow = (price: bigint) => ({ id: `t${price}`, name: "x", priceMinor: price, capacity: null, sold: 0, active: true, sortOrder: 0 });
    const ev = (id: string, prices: bigint[]) => ({
      id, title: id, description: "", venue: "", city: "", category: "", imageUrl: null, startsAt: null, active: true,
      tiers: prices.map(tierRow),
    });
    h.findMany.mockResolvedValue([ev("paid", [500_00n]), ev("free", [0n, 1000_00n])]);
    const list = await listActiveEvents({ free: true });
    expect(list.map((e) => e.id)).toEqual(["free"]);
  });

  it("offers the Free chip only when a free tier exists", async () => {
    h.tierFindFirst.mockResolvedValue({ id: "t", capacity: null, sold: 0 });
    expect((await listEventFacets()).hasFree).toBe(true);
  });
});
