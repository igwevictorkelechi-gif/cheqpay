// apps/api/src/lib/gadgetDiscounts.ts
//
// Discount codes for the gadget store. Codes are evaluated on the server at
// checkout — the client only ever gets a preview — so a tampered request can
// never invent a discount. The redemption counter is incremented inside the
// same guarded transaction as the debit (see gadgets.ts), so a capped code
// cannot be over-redeemed by concurrent checkouts.

import { Asset, prisma } from "@cheqpay/db";
import { ApiError } from "./http";
import { toMinorUnits, formatNairaMinor } from "./money";
import { ensureGadgetSchema } from "./ensureGadgets";

export type DiscountKind = "percent" | "fixed";

export interface DiscountRow {
  id: string;
  code: string;
  kind: string;
  value: bigint;
  active: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  redemptions: number;
  minSubtotalMinor: bigint | null;
}

export interface DiscountView {
  id: string;
  code: string;
  kind: DiscountKind;
  /** Whole percent for "percent"; NGN minor units for "fixed". */
  value: string;
  valueLabel: string;
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  minSubtotalMinor: string | null;
  minSubtotalFormatted: string | null;
}

export function toDiscountView(d: DiscountRow): DiscountView {
  const kind: DiscountKind = d.kind === "fixed" ? "fixed" : "percent";
  return {
    id: d.id,
    code: d.code,
    kind,
    value: d.value.toString(),
    valueLabel: kind === "percent" ? `${d.value}% off` : `${formatNairaMinor(d.value)} off`,
    active: d.active,
    startsAt: d.startsAt ? d.startsAt.toISOString() : null,
    expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
    maxRedemptions: d.maxRedemptions,
    redemptions: d.redemptions,
    minSubtotalMinor: d.minSubtotalMinor ? d.minSubtotalMinor.toString() : null,
    minSubtotalFormatted: d.minSubtotalMinor ? formatNairaMinor(d.minSubtotalMinor) : null,
  };
}

/** The discount a code takes off a subtotal, clamped so the total never goes below zero. */
export function computeDiscountMinor(
  kind: string,
  value: bigint,
  subtotalMinor: bigint,
): bigint {
  let d: bigint;
  if (kind === "percent") {
    const pct = value < 0n ? 0n : value > 100n ? 100n : value;
    d = (subtotalMinor * pct) / 100n;
  } else {
    d = value;
  }
  if (d < 0n) d = 0n;
  if (d > subtotalMinor) d = subtotalMinor;
  return d;
}

/**
 * Throw if the code cannot be used for this subtotal right now. Does not check
 * the redemption cap by mutating — that is done atomically at checkout — but it
 * does reject an already-exhausted code so previews and checkout agree.
 */
export function assertDiscountUsable(
  row: DiscountRow,
  subtotalMinor: bigint,
  now: Date = new Date(),
): void {
  if (!row.active) {
    throw new ApiError(422, "That code is no longer active.", "code_inactive");
  }
  if (row.startsAt && now < row.startsAt) {
    throw new ApiError(422, "That code isn’t active yet.", "code_not_started");
  }
  if (row.expiresAt && now > row.expiresAt) {
    throw new ApiError(422, "That code has expired.", "code_expired");
  }
  if (row.maxRedemptions !== null && row.redemptions >= row.maxRedemptions) {
    throw new ApiError(409, "That code has been fully redeemed.", "code_exhausted");
  }
  if (row.minSubtotalMinor !== null && subtotalMinor < row.minSubtotalMinor) {
    throw new ApiError(
      422,
      `This code needs a minimum order of ${formatNairaMinor(row.minSubtotalMinor)}.`,
      "code_min_not_met",
    );
  }
}

/** Look up a code by its (case-insensitive) value, or throw 404. */
export async function findUsableCode(code: string): Promise<DiscountRow> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new ApiError(422, "Enter a discount code.", "no_code");
  const row = await prisma.gadgetDiscountCode.findUnique({ where: { code: normalized } });
  if (!row) throw new ApiError(404, "That code isn’t valid.", "invalid_code");
  return row;
}

export interface DiscountQuote {
  code: string;
  subtotalMinor: string;
  subtotalFormatted: string;
  discountMinor: string;
  discountFormatted: string;
  totalMinor: string;
  totalFormatted: string;
}

/**
 * Preview a code against a product + quantity, for the storefront. This is a
 * read-only check; the authoritative application happens in checkoutGadget.
 */
export async function quoteDiscount(input: {
  code: string;
  productId: string;
  quantity: number;
}): Promise<DiscountQuote> {
  await ensureGadgetSchema();
  const qty = Math.trunc(input.quantity);
  if (!Number.isFinite(qty) || qty < 1) {
    throw new ApiError(422, "Choose at least one item.", "bad_quantity");
  }
  const product = await prisma.gadgetProduct.findUnique({ where: { id: input.productId } });
  if (!product || !product.active) {
    throw new ApiError(404, "That product isn’t available.", "product_not_found");
  }
  const subtotalMinor = product.priceMinor * BigInt(qty);

  const row = await findUsableCode(input.code);
  assertDiscountUsable(row, subtotalMinor);
  const discountMinor = computeDiscountMinor(row.kind, row.value, subtotalMinor);
  const totalMinor = subtotalMinor - discountMinor;

  return {
    code: row.code,
    subtotalMinor: subtotalMinor.toString(),
    subtotalFormatted: formatNairaMinor(subtotalMinor),
    discountMinor: discountMinor.toString(),
    discountFormatted: formatNairaMinor(discountMinor),
    totalMinor: totalMinor.toString(),
    totalFormatted: formatNairaMinor(totalMinor),
  };
}

// ---- Admin CRUD -----------------------------------------------------------

export async function listDiscountCodes(): Promise<DiscountView[]> {
  await ensureGadgetSchema();
  const rows = await prisma.gadgetDiscountCode.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(toDiscountView);
}

export interface DiscountInput {
  code: string;
  kind: DiscountKind;
  /** For percent: whole percent 1–100. For fixed: NGN decimal string. */
  value: string;
  active?: boolean;
  startsAt?: string | null;
  expiresAt?: string | null;
  maxRedemptions?: number | null;
  /** NGN decimal string, or null. */
  minSubtotal?: string | null;
}

function normalizeValue(kind: DiscountKind, value: string): bigint {
  if (kind === "percent") {
    const pct = Math.trunc(Number(value));
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      throw new ApiError(422, "Percent must be between 1 and 100.", "bad_percent");
    }
    return BigInt(pct);
  }
  const minor = toMinorUnits(value, Asset.NGN);
  if (minor <= 0n) {
    throw new ApiError(422, "Amount off must be greater than zero.", "bad_amount");
  }
  return minor;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new ApiError(422, "Invalid date.", "bad_date");
  return d;
}

function minSubtotalMinor(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const minor = toMinorUnits(value, Asset.NGN);
  return minor <= 0n ? null : minor;
}

export async function createDiscountCode(input: DiscountInput): Promise<DiscountView> {
  await ensureGadgetSchema();
  const code = input.code?.trim().toUpperCase();
  if (!code) throw new ApiError(422, "A code is required.", "no_code");
  if (!/^[A-Z0-9._-]{2,40}$/.test(code)) {
    throw new ApiError(422, "Use 2–40 letters, numbers, or - . _", "bad_code");
  }
  const existing = await prisma.gadgetDiscountCode.findUnique({ where: { code } });
  if (existing) throw new ApiError(409, "That code already exists.", "code_exists");

  const row = await prisma.gadgetDiscountCode.create({
    data: {
      code,
      kind: input.kind === "fixed" ? "fixed" : "percent",
      value: normalizeValue(input.kind, input.value),
      active: input.active ?? true,
      startsAt: parseDate(input.startsAt),
      expiresAt: parseDate(input.expiresAt),
      maxRedemptions:
        input.maxRedemptions === null || input.maxRedemptions === undefined
          ? null
          : Math.max(1, Math.trunc(input.maxRedemptions)),
      minSubtotalMinor: minSubtotalMinor(input.minSubtotal),
    },
  });
  return toDiscountView(row);
}

export async function updateDiscountCode(
  id: string,
  patch: Partial<DiscountInput>,
): Promise<DiscountView> {
  await ensureGadgetSchema();
  const existing = await prisma.gadgetDiscountCode.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Code not found.", "code_not_found");

  const kind: DiscountKind =
    patch.kind ?? (existing.kind === "fixed" ? "fixed" : "percent");

  const row = await prisma.gadgetDiscountCode.update({
    where: { id },
    data: {
      ...(patch.value !== undefined ? { value: normalizeValue(kind, patch.value) } : {}),
      ...(patch.kind !== undefined ? { kind } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.startsAt !== undefined ? { startsAt: parseDate(patch.startsAt) } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: parseDate(patch.expiresAt) } : {}),
      ...(patch.maxRedemptions !== undefined
        ? {
            maxRedemptions:
              patch.maxRedemptions === null
                ? null
                : Math.max(1, Math.trunc(patch.maxRedemptions)),
          }
        : {}),
      ...(patch.minSubtotal !== undefined
        ? { minSubtotalMinor: minSubtotalMinor(patch.minSubtotal) }
        : {}),
      updatedAt: new Date(),
    },
  });
  return toDiscountView(row);
}

export async function deleteDiscountCode(id: string): Promise<void> {
  await ensureGadgetSchema();
  await prisma.gadgetDiscountCode.deleteMany({ where: { id } });
}
