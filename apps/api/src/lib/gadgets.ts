// apps/api/src/lib/gadgets.ts
//
// The gadget store: a catalog the business curates and fulfils itself, paid for
// from the user's NGN balance. There is no third-party provider — an order is
// an internal record the operations team ships against — so a purchase is a
// purely internal money move, like a user-to-user transfer, and settles in one
// guarded transaction with no external call that could fail after the debit.
//
// Money safety mirrors the bill and transfer routes:
//   - the price is read from the database on the server, never trusted from the
//     client, so a tampered request cannot buy a ₦900,000 phone for ₦900;
//   - the debit, the stock decrement, the order and the ledger row all happen
//     in ONE transaction with a balance floor, so a user cannot be charged
//     without an order, an order cannot exist without payment, and an overdraw
//     changes zero rows instead of going negative;
//   - it is idempotent on the caller's Idempotency-Key, so a retried checkout
//     never charges or ships twice.

import {
  Asset,
  GadgetOrderStatus,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { ApiError } from "./http";
import { fromMinorUnits } from "./money";
import { ensureGadgetSchema } from "./ensureGadgets";
import { ensureGadgetTxnType } from "./ensureGadgetTxnType";
import { notifyUser } from "./alerts";

/** Sanity ceiling on a single order line — a storefront, not a wholesaler. */
const MAX_QUANTITY = 20;

export interface DeliveryDetails {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
}

/** Shape returned to clients — BigInt priced fields rendered as strings. */
export interface ProductView {
  id: string;
  name: string;
  description: string;
  priceMinor: string;
  priceFormatted: string;
  imageUrl: string | null;
  category: string;
  /** null when stock is not tracked; otherwise the units left. */
  stock: number | null;
  /** false when the item cannot currently be bought (inactive or sold out). */
  available: boolean;
  active: boolean;
}

function toProductView(p: {
  id: string;
  name: string;
  description: string;
  priceMinor: bigint;
  imageUrl: string | null;
  category: string;
  stock: number | null;
  active: boolean;
}): ProductView {
  const inStock = p.stock === null || p.stock > 0;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    priceMinor: p.priceMinor.toString(),
    priceFormatted: `₦${fromMinorUnits(p.priceMinor, Asset.NGN)}`,
    imageUrl: p.imageUrl,
    category: p.category,
    stock: p.stock,
    available: p.active && inStock,
    active: p.active,
  };
}

// ---- Catalog reads --------------------------------------------------------

/** The storefront: active products only, newest first. */
export async function listActiveProducts(): Promise<ProductView[]> {
  await ensureGadgetSchema();
  const rows = await prisma.gadgetProduct.findMany({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toProductView);
}

/** One product for the storefront. Throws 404 if it is not sellable. */
export async function getActiveProduct(id: string): Promise<ProductView> {
  await ensureGadgetSchema();
  const p = await prisma.gadgetProduct.findUnique({ where: { id } });
  if (!p || !p.active) {
    throw new ApiError(404, "That product isn’t available.", "product_not_found");
  }
  return toProductView(p);
}

// ---- Checkout -------------------------------------------------------------

export interface CheckoutInput {
  userId: string;
  productId: string;
  quantity: number;
  delivery: DeliveryDetails;
  note?: string;
  idempotencyKey: string;
}

export interface OrderView {
  id: string;
  productName: string;
  quantity: number;
  unitPriceFormatted: string;
  totalFormatted: string;
  totalMinor: string;
  status: GadgetOrderStatus;
  delivery: DeliveryDetails;
  note: string | null;
  createdAt: string;
}

function toOrderView(o: {
  id: string;
  productName: string;
  quantity: number;
  unitPriceMinor: bigint;
  totalMinor: bigint;
  status: GadgetOrderStatus;
  deliveryName: string;
  deliveryPhone: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryState: string;
  note: string | null;
  createdAt: Date;
}): OrderView {
  return {
    id: o.id,
    productName: o.productName,
    quantity: o.quantity,
    unitPriceFormatted: `₦${fromMinorUnits(o.unitPriceMinor, Asset.NGN)}`,
    totalFormatted: `₦${fromMinorUnits(o.totalMinor, Asset.NGN)}`,
    totalMinor: o.totalMinor.toString(),
    status: o.status,
    delivery: {
      name: o.deliveryName,
      phone: o.deliveryPhone,
      address: o.deliveryAddress,
      city: o.deliveryCity,
      state: o.deliveryState,
    },
    note: o.note,
    createdAt: o.createdAt.toISOString(),
  };
}

/**
 * Buy a gadget. Money-safe and idempotent. Returns the created (or, on replay,
 * the existing) order.
 *
 * The transaction PIN is checked by the route BEFORE this is called, alongside
 * the idempotency replay guard, so a wrong PIN never reaches here and never
 * leaves a half-order behind.
 */
export async function checkoutGadget(input: CheckoutInput): Promise<OrderView> {
  const qty = Math.trunc(input.quantity);
  if (!Number.isFinite(qty) || qty < 1) {
    throw new ApiError(422, "Choose at least one item.", "bad_quantity");
  }
  if (qty > MAX_QUANTITY) {
    throw new ApiError(422, `You can buy at most ${MAX_QUANTITY} of one item at a time.`, "quantity_too_high");
  }
  for (const [field, value] of Object.entries(input.delivery)) {
    if (!value || !value.trim()) {
      throw new ApiError(422, `Delivery ${field} is required.`, "delivery_incomplete");
    }
  }

  await ensureGadgetSchema();
  await ensureGadgetTxnType();

  // Idempotent replay — return the order the first request created.
  const existing = await prisma.transaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) {
    const order = await prisma.gadgetOrder.findFirst({
      where: { transactionId: existing.id, userId: input.userId },
    });
    if (order) return toOrderView(order);
  }

  // Price is authoritative from the database, never from the caller.
  const product = await prisma.gadgetProduct.findUnique({ where: { id: input.productId } });
  if (!product || !product.active) {
    throw new ApiError(404, "That product isn’t available.", "product_not_found");
  }
  if (product.stock !== null && product.stock < qty) {
    throw new ApiError(
      409,
      product.stock <= 0
        ? "That item is sold out."
        : `Only ${product.stock} left — reduce the quantity.`,
      "insufficient_stock",
    );
  }

  const unitPriceMinor = product.priceMinor;
  const totalMinor = unitPriceMinor * BigInt(qty);

  const order = await prisma.$transaction(async (db) => {
    // Guarded debit: a balance floor means an overdraw changes zero rows.
    const debit = await db.balance.updateMany({
      where: { userId: input.userId, asset: Asset.NGN, available: { gte: totalMinor } },
      data: { available: { decrement: totalMinor } },
    });
    if (debit.count !== 1) {
      throw new ApiError(422, "Insufficient NGN balance", "insufficient_funds");
    }

    // Guarded stock decrement: untracked (null) always passes; a tracked count
    // must still cover the quantity at commit time, closing the race between
    // the check above and here.
    if (product.stock !== null) {
      const dec = await db.gadgetProduct.updateMany({
        where: { id: product.id, stock: { gte: qty } },
        data: { stock: { decrement: qty } },
      });
      if (dec.count !== 1) {
        throw new ApiError(409, "That item just sold out.", "insufficient_stock");
      }
    }

    const tx = await db.transaction.create({
      data: {
        userId: input.userId,
        type: TransactionType.GADGET_PURCHASE,
        asset: Asset.NGN,
        amount: totalMinor,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: input.idempotencyKey,
        metadata: {
          kind: "gadget",
          productId: product.id,
          productName: product.name,
          quantity: qty,
        },
      },
    });

    const created = await db.gadgetOrder.create({
      data: {
        userId: input.userId,
        productId: product.id,
        productName: product.name,
        quantity: qty,
        unitPriceMinor,
        totalMinor,
        status: GadgetOrderStatus.PAID,
        deliveryName: input.delivery.name.trim(),
        deliveryPhone: input.delivery.phone.trim(),
        deliveryAddress: input.delivery.address.trim(),
        deliveryCity: input.delivery.city.trim(),
        deliveryState: input.delivery.state.trim(),
        note: input.note?.trim() || null,
        transactionId: tx.id,
      },
    });

    await db.auditLog.create({
      data: {
        userId: input.userId,
        action: "gadget.ordered",
        resourceType: "GadgetOrder",
        resourceId: created.id,
        details: {
          productId: product.id,
          quantity: qty,
          totalMinor: totalMinor.toString(),
        },
      },
    });

    return created;
  });

  // Best-effort alert after the money has settled.
  await notifyUser(input.userId, {
    category: "withdrawals",
    emailKind: "money_out",
    title: "Order placed",
    body: `Your order for ${qty} × ${product.name} is confirmed. We’ll be in touch about delivery.`,
    amount: `₦${fromMinorUnits(totalMinor, Asset.NGN)}`,
    data: { orderId: order.id },
    details: [
      { label: "Item", value: `${qty} × ${product.name}` },
      { label: "Total", value: `₦${fromMinorUnits(totalMinor, Asset.NGN)}` },
      { label: "Deliver to", value: `${input.delivery.address.trim()}, ${input.delivery.city.trim()}` },
    ],
  }).catch(() => {});

  return toOrderView(order);
}

// ---- Order reads ----------------------------------------------------------

export async function listUserOrders(userId: string): Promise<OrderView[]> {
  await ensureGadgetSchema();
  const rows = await prisma.gadgetOrder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toOrderView);
}

export async function getUserOrder(userId: string, id: string): Promise<OrderView> {
  await ensureGadgetSchema();
  const o = await prisma.gadgetOrder.findFirst({ where: { id, userId } });
  if (!o) throw new ApiError(404, "Order not found.", "order_not_found");
  return toOrderView(o);
}

// ---- Admin ----------------------------------------------------------------

export { toOrderView, toProductView, MAX_QUANTITY };
