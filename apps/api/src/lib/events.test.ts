import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tierFindUnique: vi.fn(),
  tierUpdateMany: vi.fn(),
  tierUpdate: vi.fn(),
  txFindUnique: vi.fn(),
  txCreate: vi.fn(),
  balanceUpdateMany: vi.fn(),
  orderCreate: vi.fn(),
  orderFindFirst: vi.fn(),
  ticketCreate: vi.fn(),
  ticketCount: vi.fn(),
  auditCreate: vi.fn(),
  notifyUser: vi.fn(),
}));

const db = {
  balance: { updateMany: h.balanceUpdateMany },
  ticketTier: { updateMany: h.tierUpdateMany, update: h.tierUpdate },
  transaction: { create: h.txCreate },
  ticketOrder: { create: h.orderCreate },
  ticket: { create: h.ticketCreate, count: h.ticketCount },
  auditLog: { create: h.auditCreate },
};

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN" },
  TicketStatus: { VALID: "VALID", USED: "USED", CANCELLED: "CANCELLED", REFUNDED: "REFUNDED" },
  TransactionStatus: { COMPLETED: "COMPLETED", REVERSED: "REVERSED" },
  TransactionType: { TICKET_PURCHASE: "TICKET_PURCHASE" },
  prisma: {
    ticketTier: { findUnique: h.tierFindUnique },
    transaction: { findUnique: h.txFindUnique },
    ticketOrder: { findFirst: h.orderFindFirst },
    $transaction: (cb: (tx: typeof db) => unknown) => cb(db),
  },
}));
vi.mock("./ensureEvents", () => ({ ensureEventsSchema: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureTicketTxnType", () => ({ ensureTicketTxnType: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./alerts", () => ({ notifyUser: h.notifyUser }));

import { checkoutTickets, toEventView, toTierView } from "./events";

const base = {
  userId: "u1",
  eventId: "e1",
  tierId: "t1",
  quantity: 2,
  idempotencyKey: "idem-1",
};

function tier(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    eventId: "e1",
    name: "VIP",
    priceMinor: 5_000_00n, // ₦5,000
    capacity: null,
    sold: 0,
    active: true,
    event: { id: "e1", title: "Concert", active: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.txFindUnique.mockResolvedValue(null);
  h.orderFindFirst.mockResolvedValue(null);
  h.balanceUpdateMany.mockResolvedValue({ count: 1 });
  h.tierUpdateMany.mockResolvedValue({ count: 1 });
  h.tierUpdate.mockResolvedValue({});
  h.txCreate.mockResolvedValue({ id: "tx1" });
  h.orderCreate.mockResolvedValue({ id: "o1", quantity: 2, totalMinor: 10_000_00n, createdAt: new Date() });
  let n = 0;
  h.ticketCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: `tk${++n}`, reference: data.reference, status: "VALID", eventTitle: "Concert", tierName: "VIP" }),
  );
  h.auditCreate.mockResolvedValue({});
  h.ticketCount.mockResolvedValue(0);
  h.notifyUser.mockResolvedValue(undefined);
});

describe("checkoutTickets", () => {
  it("debits price × quantity and issues one ticket per seat", async () => {
    h.tierFindUnique.mockResolvedValue(tier());
    const order = await checkoutTickets(base);

    expect(h.balanceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ available: { gte: 10_000_00n } }),
        data: { available: { decrement: 10_000_00n } },
      }),
    );
    expect(h.ticketCreate).toHaveBeenCalledTimes(2);
    expect(order.tickets).toHaveLength(2);
    expect(order.totalFormatted).toBe("₦10,000");
    // Each ticket carries a unique reference.
    expect(new Set(order.tickets.map((t) => t.reference)).size).toBe(2);
  });

  it("refuses to overdraw — a guarded debit that changes no row aborts", async () => {
    h.tierFindUnique.mockResolvedValue(tier());
    h.balanceUpdateMany.mockResolvedValue({ count: 0 });
    await expect(checkoutTickets(base)).rejects.toMatchObject({ status: 422, code: "insufficient_funds" });
    expect(h.ticketCreate).not.toHaveBeenCalled();
  });

  it("rejects when the tier would oversell its capacity", async () => {
    h.tierFindUnique.mockResolvedValue(tier({ capacity: 100, sold: 99 }));
    await expect(checkoutTickets({ ...base, quantity: 2 })).rejects.toMatchObject({ status: 409, code: "sold_out" });
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
  });

  it("guards capacity inside the transaction (race at commit)", async () => {
    h.tierFindUnique.mockResolvedValue(tier({ capacity: 100, sold: 0 }));
    h.tierUpdateMany.mockResolvedValue({ count: 0 }); // someone else took the last seats
    await expect(checkoutTickets(base)).rejects.toMatchObject({ status: 409, code: "sold_out" });
  });

  it("replays idempotently — returns the existing order, no second charge", async () => {
    h.txFindUnique.mockResolvedValue({ id: "tx1" });
    h.orderFindFirst.mockResolvedValue({
      id: "o1",
      quantity: 2,
      totalMinor: 10_000_00n,
      createdAt: new Date(),
      tickets: [{ id: "tk1", reference: "CHQ-AAAAA-BBBBB", status: "VALID", eventTitle: "Concert", tierName: "VIP" }],
    });
    const order = await checkoutTickets(base);
    expect(order.id).toBe("o1");
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
  });

  it("validates quantity", async () => {
    h.tierFindUnique.mockResolvedValue(tier());
    await expect(checkoutTickets({ ...base, quantity: 0 })).rejects.toMatchObject({ status: 422 });
    await expect(checkoutTickets({ ...base, quantity: 99 })).rejects.toMatchObject({ status: 422 });
  });

  it("404s when the tier is missing or inactive", async () => {
    h.tierFindUnique.mockResolvedValue(null);
    await expect(checkoutTickets(base)).rejects.toMatchObject({ status: 404 });
  });
});

describe("free events", () => {
  const freeTier = () => tier({ priceMinor: 0n, name: "General" });

  it("issues free tickets without touching the balance", async () => {
    h.tierFindUnique.mockResolvedValue(freeTier());
    h.orderCreate.mockResolvedValue({ id: "o1", quantity: 2, totalMinor: 0n, createdAt: new Date() });
    const order = await checkoutTickets(base);
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
    expect(h.ticketCreate).toHaveBeenCalledTimes(2);
    expect(order.totalFormatted).toBe("Free");
    expect(h.txCreate.mock.calls[0][0].data.amount).toBe(0n);
    const msg = h.notifyUser.mock.calls[0][1];
    expect(msg.amount).toBeUndefined();
    expect(msg.category).toBe("updates");
  });

  it("caps how many free tickets one person can hold per tier", async () => {
    h.tierFindUnique.mockResolvedValue(freeTier());
    h.ticketCount.mockResolvedValue(3);
    await expect(checkoutTickets(base)).rejects.toMatchObject({ code: "free_limit" });
    expect(h.ticketCreate).not.toHaveBeenCalled();
  });

  it("still respects capacity", async () => {
    h.tierFindUnique.mockResolvedValue({ ...freeTier(), capacity: 1, sold: 1 });
    await expect(checkoutTickets(base)).rejects.toMatchObject({ code: "sold_out" });
  });

  it("labels free tiers and events as Free", () => {
    const row = { id: "t", name: "Gen", priceMinor: 0n, capacity: null, sold: 0, active: true, sortOrder: 0 };
    expect(toTierView(row)).toMatchObject({ free: true, priceFormatted: "Free" });
    const ev = toEventView({
      id: "e", title: "T", description: "", venue: "", city: "", category: "", imageUrl: null,
      startsAt: null, active: true,
      tiers: [row, { ...row, id: "t2", priceMinor: 500_00n }],
    });
    expect(ev.free).toBe(true);
    expect(ev.fromPriceFormatted).toBe("Free");
  });
});
