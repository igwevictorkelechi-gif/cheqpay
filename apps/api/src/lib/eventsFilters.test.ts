import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@cheqpay/db", () => ({
  Prisma: {},
  TicketStatus: { VALID: "VALID" },
  prisma: { event: { findMany: h.findMany } },
}));
vi.mock("./ensureEvents", () => ({ ensureEventsSchema: vi.fn().mockResolvedValue(undefined) }));

import { listActiveEvents, listEventFacets } from "./events";

beforeEach(() => {
  vi.clearAllMocks();
  h.findMany.mockResolvedValue([]);
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
    await expect(listEventFacets()).resolves.toEqual({ cities: ["Abuja", "Lagos"], categories: ["Music", "Comedy"] });
  });
});
