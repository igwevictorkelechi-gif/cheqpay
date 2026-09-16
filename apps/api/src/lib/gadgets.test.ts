import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  productFindUnique: vi.fn(),
  productUpdateMany: vi.fn(),
  txFindUnique: vi.fn(),
  txCreate: vi.fn(),
  balanceUpdateMany: vi.fn(),
  orderCreate: vi.fn(),
  orderFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  notifyUser: vi.fn(),
}));

const db = {
  balance: { updateMany: h.balanceUpdateMany },
  gadgetProduct: { updateMany: h.productUpdateMany },
  transaction: { create: h.txCreate },
  gadgetOrder: { create: h.orderCreate },
  auditLog: { create: h.auditCreate },
};

vi.mock("@cheqpay/db", () => ({
  Asset: { NGN: "NGN" },
  GadgetOrderStatus: {
    PAID: "PAID",
    PROCESSING: "PROCESSING",
    SHIPPED: "SHIPPED",
    DELIVERED: "DELIVERED",
    CANCELLED: "CANCELLED",
    REFUNDED: "REFUNDED",
  },
  TransactionStatus: { COMPLETED: "COMPLETED", REVERSED: "REVERSED" },
  TransactionType: { GADGET_PURCHASE: "GADGET_PURCHASE" },
  prisma: {
    gadgetProduct: { findUnique: h.productFindUnique, updateMany: h.productUpdateMany },
    transaction: { findUnique: h.txFindUnique },
    gadgetOrder: { findFirst: h.orderFindFirst },
    $transaction: (cb: (tx: typeof db) => unknown) => cb(db),
  },
}));
vi.mock("./ensureGadgets", () => ({ ensureGadgetSchema: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ensureGadgetTxnType", () => ({ ensureGadgetTxnType: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./alerts", () => ({ notifyUser: h.notifyUser }));

import { checkoutGadget } from "./gadgets";
import { ApiError } from "./http";

const delivery = {
  name: "Ada Obi",
  phone: "08030000000",
  address: "12 Marina Road",
  city: "Lagos",
  state: "Lagos",
};

const product = {
  id: "prod-1",
  name: "Wireless earbuds",
  description: "",
  priceMinor: 4500000n, // ₦45,000
  imageUrl: null,
  category: "audio",
  stock: 10,
  active: true,
};

const base = {
  userId: "user-1",
  productId: "prod-1",
  quantity: 2,
  delivery,
  idempotencyKey: "key-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.productFindUnique.mockResolvedValue(product);
  h.txFindUnique.mockResolvedValue(null);
  h.orderFindFirst.mockResolvedValue(null);
  h.balanceUpdateMany.mockResolvedValue({ count: 1 });
  h.productUpdateMany.mockResolvedValue({ count: 1 });
  h.txCreate.mockResolvedValue({ id: "tx-1" });
  h.orderCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: "order-1",
      productName: data.productName,
      quantity: data.quantity,
      unitPriceMinor: data.unitPriceMinor,
      totalMinor: data.totalMinor,
      status: data.status,
      deliveryName: data.deliveryName,
      deliveryPhone: data.deliveryPhone,
      deliveryAddress: data.deliveryAddress,
      deliveryCity: data.deliveryCity,
      deliveryState: data.deliveryState,
      note: data.note,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }),
  );
  h.auditCreate.mockResolvedValue({});
  h.notifyUser.mockResolvedValue({});
});

describe("checkoutGadget", () => {
  it("charges the server-side price × quantity, not anything from the client", async () => {
    const order = await checkoutGadget(base);
    // 2 × ₦45,000 = ₦90,000 = 9,000,000 kobo. The client never sends a price.
    expect(h.balanceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ available: { gte: 9_000_000n } }),
        data: { available: { decrement: 9_000_000n } },
      }),
    );
    expect(order.totalFormatted).toBe("₦90000.00");
    expect(order.quantity).toBe(2);
  });

  it("records the ledger row and the order together", async () => {
    await checkoutGadget(base);
    expect(h.txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "GADGET_PURCHASE",
          amount: 9_000_000n,
          idempotencyKey: "key-1",
        }),
      }),
    );
    expect(h.orderCreate).toHaveBeenCalledOnce();
  });

  it("refuses when the balance floor is not met (no overdraw)", async () => {
    h.balanceUpdateMany.mockResolvedValue({ count: 0 });
    await expect(checkoutGadget(base)).rejects.toMatchObject({ status: 422 });
    // The order must NOT be created when the debit changed no rows.
    expect(h.orderCreate).not.toHaveBeenCalled();
  });

  it("replays: an already-used idempotency key returns the first order, no new charge", async () => {
    h.txFindUnique.mockResolvedValue({ id: "tx-1" });
    h.orderFindFirst.mockResolvedValue({
      id: "order-1",
      productName: "Wireless earbuds",
      quantity: 2,
      unitPriceMinor: 4500000n,
      totalMinor: 9000000n,
      status: "PAID",
      deliveryName: delivery.name,
      deliveryPhone: delivery.phone,
      deliveryAddress: delivery.address,
      deliveryCity: delivery.city,
      deliveryState: delivery.state,
      note: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const order = await checkoutGadget(base);
    expect(order.id).toBe("order-1");
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
    expect(h.txCreate).not.toHaveBeenCalled();
  });

  it("rejects a sold-out or under-stocked product before charging", async () => {
    h.productFindUnique.mockResolvedValue({ ...product, stock: 1 });
    await expect(checkoutGadget({ ...base, quantity: 2 })).rejects.toMatchObject({ status: 409 });
    expect(h.balanceUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown or inactive product", async () => {
    h.productFindUnique.mockResolvedValue(null);
    await expect(checkoutGadget(base)).rejects.toBeInstanceOf(ApiError);
    h.productFindUnique.mockResolvedValue({ ...product, active: false });
    await expect(checkoutGadget(base)).rejects.toMatchObject({ status: 404 });
  });

  it("requires a complete delivery address", async () => {
    await expect(
      checkoutGadget({ ...base, delivery: { ...delivery, city: "" } }),
    ).rejects.toMatchObject({ status: 422, code: "delivery_incomplete" });
  });

  it("rejects a non-positive or oversized quantity", async () => {
    await expect(checkoutGadget({ ...base, quantity: 0 })).rejects.toMatchObject({ status: 422 });
    await expect(checkoutGadget({ ...base, quantity: 999 })).rejects.toMatchObject({ status: 422 });
  });

  it("decrements tracked stock inside the transaction, guarded", async () => {
    await checkoutGadget(base);
    expect(h.productUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prod-1", stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      }),
    );
  });

  it("does not touch stock for an untracked product", async () => {
    h.productFindUnique.mockResolvedValue({ ...product, stock: null });
    await checkoutGadget(base);
    expect(h.productUpdateMany).not.toHaveBeenCalled();
  });
});
