// apps/api/src/lib/gadgetsAdmin.ts
//
// Admin side of the gadget store: catalog CRUD, the order queue, fulfilment
// status changes, and refunds. Kept apart from lib/gadgets.ts so the customer
// path never imports the admin mutations.

import {
  Asset,
  GadgetOrderStatus,
  Prisma,
  TransactionStatus,
  TransactionType,
  prisma,
} from "@cheqpay/db";
import { ApiError } from "./http";
import { toMinorUnits } from "./money";
import { ensureGadgetSchema } from "./ensureGadgets";
import { ensureGadgetTxnType } from "./ensureGadgetTxnType";
import {
  normalizeSpecs,
  toOrderView,
  toProductView,
  type GadgetSpec,
  type OrderView,
  type ProductView,
} from "./gadgets";

// ---- Catalog CRUD ---------------------------------------------------------

/** Every product, active or not, for the catalog manager. */
export async function listAllProducts(): Promise<ProductView[]> {
  await ensureGadgetSchema();
  const rows = await prisma.gadgetProduct.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(toProductView);
}

/** One product by id, active or not — for the catalog editor. */
export async function getProductById(id: string): Promise<ProductView> {
  await ensureGadgetSchema();
  const row = await prisma.gadgetProduct.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "Product not found.", "product_not_found");
  return toProductView(row);
}

export interface ProductInput {
  name: string;
  description?: string;
  /** Naira as a decimal string, e.g. "45000" or "45000.00". */
  price: string;
  /** Optional "was" price as a decimal string; "" / null clears it. */
  compareAt?: string | null;
  imageUrl?: string | null;
  category?: string;
  /** Detailed specifications as {label, value} rows. */
  specs?: GadgetSpec[];
  /** null / omitted = not stock-tracked. */
  stock?: number | null;
  active?: boolean;
}

function priceToMinor(price: string): bigint {
  const minor = toMinorUnits(price, Asset.NGN);
  if (minor <= 0n) {
    throw new ApiError(422, "Price must be greater than zero.", "bad_price");
  }
  return minor;
}

/** Optional compare-at ("was") price. Empty/blank clears it (returns null). */
function compareAtToMinor(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const minor = toMinorUnits(value, Asset.NGN);
  if (minor <= 0n) {
    throw new ApiError(422, "Compare-at price must be greater than zero.", "bad_compare_at");
  }
  return minor;
}

function cleanStock(stock: number | null | undefined): number | null {
  if (stock === null || stock === undefined) return null;
  const n = Math.trunc(stock);
  if (!Number.isFinite(n) || n < 0) {
    throw new ApiError(422, "Stock can’t be negative.", "bad_stock");
  }
  return n;
}

export async function createProduct(input: ProductInput): Promise<ProductView> {
  await ensureGadgetSchema();
  if (!input.name?.trim()) throw new ApiError(422, "Name is required.", "no_name");
  const row = await prisma.gadgetProduct.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      priceMinor: priceToMinor(input.price),
      compareAtMinor: compareAtToMinor(input.compareAt),
      imageUrl: input.imageUrl?.trim() || null,
      category: input.category?.trim() ?? "",
      specs: normalizeSpecs(input.specs) as unknown as Prisma.InputJsonValue,
      stock: cleanStock(input.stock),
      active: input.active ?? true,
    },
  });
  return toProductView(row);
}

export async function updateProduct(
  id: string,
  patch: Partial<ProductInput>,
): Promise<ProductView> {
  await ensureGadgetSchema();
  const exists = await prisma.gadgetProduct.findUnique({ where: { id } });
  if (!exists) throw new ApiError(404, "Product not found.", "product_not_found");

  const row = await prisma.gadgetProduct.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.price !== undefined ? { priceMinor: priceToMinor(patch.price) } : {}),
      ...(patch.compareAt !== undefined
        ? { compareAtMinor: compareAtToMinor(patch.compareAt) }
        : {}),
      ...(patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl?.trim() || null } : {}),
      ...(patch.category !== undefined ? { category: patch.category.trim() } : {}),
      ...(patch.specs !== undefined
        ? { specs: normalizeSpecs(patch.specs) as unknown as Prisma.InputJsonValue }
        : {}),
      ...(patch.stock !== undefined ? { stock: cleanStock(patch.stock) } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      updatedAt: new Date(),
    },
  });
  return toProductView(row);
}

/** Soft-remove: deactivate rather than delete, so order history stays intact. */
export async function deactivateProduct(id: string): Promise<ProductView> {
  return updateProduct(id, { active: false });
}

// ---- Orders ---------------------------------------------------------------

export interface AdminOrderView extends OrderView {
  userId: string;
  userEmail: string | null;
}

export async function listAllOrders(status?: GadgetOrderStatus): Promise<AdminOrderView[]> {
  await ensureGadgetSchema();
  const rows = await prisma.gadgetOrder.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true } } },
  });
  return rows.map((o) => ({
    ...toOrderView(o),
    userId: o.userId,
    userEmail: o.user?.email ?? null,
  }));
}

/** Fulfilment transitions that do NOT move money. */
const FULFILMENT_STATES: GadgetOrderStatus[] = [
  GadgetOrderStatus.PAID,
  GadgetOrderStatus.PROCESSING,
  GadgetOrderStatus.SHIPPED,
  GadgetOrderStatus.DELIVERED,
];

/**
 * Advance an order through fulfilment. Refund states (CANCELLED / REFUNDED) are
 * refused here — they move money and must go through refundOrder so the credit
 * and the status change are one transaction.
 */
export async function setOrderStatus(
  id: string,
  status: GadgetOrderStatus,
  adminId?: string,
): Promise<AdminOrderView> {
  await ensureGadgetSchema();
  if (!FULFILMENT_STATES.includes(status)) {
    throw new ApiError(
      422,
      "Use refund to cancel or refund an order — it returns the money.",
      "use_refund",
    );
  }
  const order = await prisma.gadgetOrder.findUnique({ where: { id } });
  if (!order) throw new ApiError(404, "Order not found.", "order_not_found");
  if (order.status === GadgetOrderStatus.REFUNDED || order.status === GadgetOrderStatus.CANCELLED) {
    throw new ApiError(409, "This order was refunded and can’t be fulfilled.", "order_refunded");
  }

  const updated = await prisma.gadgetOrder.update({
    where: { id },
    data: { status, updatedAt: new Date() },
    include: { user: { select: { email: true } } },
  });
  await prisma.auditLog.create({
    data: {
      userId: adminId ?? null,
      action: "gadget.order.status",
      resourceType: "GadgetOrder",
      resourceId: id,
      details: { status },
    },
  });
  return { ...toOrderView(updated), userId: updated.userId, userEmail: updated.user?.email ?? null };
}

/**
 * Refund (and cancel) an order: return the money to the customer's NGN balance
 * and mark the order. Money-safe and idempotent — the credit and the status
 * change happen in one transaction, and an order already refunded is left
 * untouched so a double click cannot pay out twice.
 */
export async function refundOrder(
  id: string,
  target: GadgetOrderStatus = GadgetOrderStatus.REFUNDED,
  adminId?: string,
): Promise<AdminOrderView> {
  if (target !== GadgetOrderStatus.REFUNDED && target !== GadgetOrderStatus.CANCELLED) {
    throw new ApiError(422, "A refund can only cancel or refund an order.", "bad_refund_target");
  }
  await ensureGadgetSchema();
  await ensureGadgetTxnType();

  const updated = await prisma.$transaction(async (db) => {
    const order = await db.gadgetOrder.findUnique({ where: { id } });
    if (!order) throw new ApiError(404, "Order not found.", "order_not_found");
    if (order.status === GadgetOrderStatus.REFUNDED || order.status === GadgetOrderStatus.CANCELLED) {
      throw new ApiError(409, "This order was already refunded.", "already_refunded");
    }
    if (order.status === GadgetOrderStatus.DELIVERED) {
      throw new ApiError(
        409,
        "This order is already delivered; refunding a delivered order isn’t supported here.",
        "already_delivered",
      );
    }

    // Return the money. Restore stock too, so a cancelled order frees the unit.
    await db.balance.upsert({
      where: { userId_asset: { userId: order.userId, asset: Asset.NGN } },
      update: { available: { increment: order.totalMinor } },
      create: { userId: order.userId, asset: Asset.NGN, available: order.totalMinor },
    });
    if (order.productId) {
      await db.gadgetProduct.updateMany({
        where: { id: order.productId, stock: { not: null } },
        data: { stock: { increment: order.quantity } },
      });
    }

    await db.transaction.create({
      data: {
        userId: order.userId,
        type: TransactionType.GADGET_PURCHASE,
        asset: Asset.NGN,
        amount: order.totalMinor,
        status: TransactionStatus.REVERSED,
        idempotencyKey: `gadget-refund:${order.id}`,
        metadata: { kind: "gadget_refund", orderId: order.id, productName: order.productName },
      },
    });

    const next = await db.gadgetOrder.update({
      where: { id },
      data: { status: target, updatedAt: new Date() },
      include: { user: { select: { email: true } } },
    });
    await db.auditLog.create({
      data: {
        userId: adminId ?? null,
        action: "gadget.order.refunded",
        resourceType: "GadgetOrder",
        resourceId: id,
        details: { target, totalMinor: order.totalMinor.toString() },
      },
    });
    return next;
  });

  return { ...toOrderView(updated), userId: updated.userId, userEmail: updated.user?.email ?? null };
}
