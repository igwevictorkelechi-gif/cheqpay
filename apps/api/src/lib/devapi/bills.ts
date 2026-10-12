// apps/api/src/lib/devapi/bills.ts
//
// Bill payments for developers: airtime, data, electricity and cable TV, paid
// from any of their NGN wallets (the main wallet by default).
//
// Live payments go through the same bills provider and the same curated
// catalog the app uses, so a developer can buy exactly what an app user can.
// The order is the one every money-out path here follows:
//   1. debit the wallet (amount + the plan's bill fee) and record a pending
//      bill_payment, atomically, inside the daily outflow limit;
//   2. send the purchase, with our transaction id as its reference;
//   3. settle: successful, or failed and refunded in full.
// Only a definite refusal refunds straight away (the provider said no, or we
// never sent it). A timeout or a 5xx leaves the payment pending: the provider
// may have delivered it, and refunding then could pay twice. Pending payments
// settle from the provider's webhook, a requery sweep, or ops.
//
// The sandbox never calls the provider. Customer numbers ending in 0000 fail,
// ending in 1111 stay pending (settle them with the test helper), and anything
// else succeeds at once.

import { Asset, prisma } from "@cheqpay/db";
import { z } from "zod";
import { getBillsProvider, billsProviderNamed, type BillsProvider } from "@/payments";
import { BillPaymentError } from "@/payments/types";
import { getFeatureFlags } from "../features";
import { getBiller, getPlan, getServiceConfig, providerBillerCode, type BillPlan } from "../bills";
import { getBillCatalog, getLivePlan } from "../billCatalog";
import { toMinorUnits } from "../money";
import { scrubProviderNames } from "../publicMessage";
import { alertOpsOnce } from "../opsAlert";
import { V1Error, type ApiContext, type HandlerResult } from "./handler";
import { effectiveLimits, getDevLimits } from "./limits";
import {
  applyLegs,
  assertWithinOutflowLimits,
  ensureMainWallets,
  getMainWallet,
  getTransaction,
  getWallet,
  insertTransaction,
} from "./ledger";
import { recordEvent } from "./events";
import { deliverSoon } from "./webhooks";
import { amountSchema, descriptionSchema, metadataSchema, referenceSchema, resolveId, uniqueViolation } from "./inputs";
import { runIdempotent } from "./idempotency";
import { transactionObject } from "./serialize";
import type { DevPlan } from "./plans";
import type { DevTransactionRow, Mode } from "./types";

const MONEY_TX = { maxWait: 10_000, timeout: 15_000 };

/** The services the API sells. Betting and food have no biller yet. */
export const BILL_SERVICES = ["airtime", "data", "electricity", "cabletv"] as const;
export type ApiBillService = (typeof BILL_SERVICES)[number];

const PHONE_SERVICES = new Set<string>(["airtime", "data"]);

/** A pending live bill nobody can find at the provider is refunded after this long. */
export const NOT_FOUND_REFUND_AFTER_MS = 30 * 60_000;

const serviceSchema = z.enum(BILL_SERVICES);
const customerSchema = z.string().trim().min(6).max(30);

export const billValidateSchema = z
  .object({
    service: serviceSchema,
    biller_id: z.string().min(1).max(60),
    customer: customerSchema,
  })
  .strict();

export const billPaymentSchema = z
  .object({
    service: serviceSchema,
    biller_id: z.string().min(1).max(60),
    customer: customerSchema,
    plan_id: z.string().min(1).max(120).optional(),
    amount: amountSchema.optional(),
    wallet_id: z.string().max(80).optional(),
    reference: referenceSchema.optional(),
    description: descriptionSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const testSettleSchema = z.object({ outcome: z.enum(["successful", "failed"]) }).strict();

/** The plan's bill fee on an amount: basis points, capped (a cap of 0 means none). */
export function billFee(plan: Pick<DevPlan, "billFeeBps" | "billFeeCapMinor">, amountMinor: bigint): bigint {
  let fee = (amountMinor * BigInt(plan.billFeeBps)) / 10_000n;
  if (plan.billFeeCapMinor > 0 && fee > BigInt(plan.billFeeCapMinor)) fee = BigInt(plan.billFeeCapMinor);
  return fee;
}

/**
 * The customer identifier as we send it: a Nigerian phone number in local
 * 11-digit form for airtime and data, digits only for meters and smartcards.
 * Null when it can't be one.
 */
export function normaliseBillCustomer(service: string, raw: string): string | null {
  if (PHONE_SERVICES.has(service)) {
    const digits = raw.replace(/[\s\-()]/g, "").replace(/^\+/, "");
    if (/^234[789][01]\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
    if (/^0[789][01]\d{8}$/.test(digits)) return digits;
    return null;
  }
  const id = raw.replace(/[\s-]/g, "");
  return /^\d{6,20}$/.test(id) ? id : null;
}

/** What the sandbox does with a customer number. */
export function sandboxOutcome(customer: string): "successful" | "failed" | "pending" {
  if (customer.endsWith("0000")) return "failed";
  if (customer.endsWith("1111")) return "pending";
  return "successful";
}

const SANDBOX_TOKEN = "1234-5678-9012-3456-7890";

async function assertBillsOpen(): Promise<void> {
  if (!(await getFeatureFlags()).bill_payments) {
    throw new V1Error(503, "Bill payments are temporarily unavailable.", "feature_disabled");
  }
}

/** The live bills provider, or a clean 503 when it isn't configured. */
function liveProvider(): BillsProvider {
  try {
    return getBillsProvider();
  } catch {
    throw new V1Error(503, "Bill payments are temporarily unavailable.", "service_unavailable");
  }
}

function koboOf(plan: BillPlan): bigint {
  return toMinorUnits(plan.amount, Asset.NGN);
}

// ---------------------------------------------------------------------------
// Catalogue

/** Services and their billers. In live mode `available` says whether a biller can be paid right now. */
export function listBillServices(mode: Mode) {
  let providerName: string | null = null;
  if (mode === "live") {
    try {
      providerName = getBillsProvider().name;
    } catch {
      providerName = null;
    }
  }
  const data = BILL_SERVICES.map((service) => {
    const cfg = getServiceConfig(service)!;
    return {
      object: "bill_service",
      id: service,
      name: cfg.label,
      customer_label: cfg.customerLabel,
      amount_type: cfg.variableAmount ? "amount" : "plan",
      requires_validation: cfg.requiresValidation,
      billers: cfg.billers.map((b) => ({
        id: b.id,
        name: b.name,
        available:
          mode === "test" ? true : providerName !== null && (providerName === "mock" || Boolean(providerBillerCode(b, providerName, "pay"))),
      })),
    };
  });
  return { object: "list", data, has_more: false };
}

function planObject(p: BillPlan) {
  return {
    object: "bill_plan",
    id: p.id,
    biller_id: p.billerId,
    name: p.name,
    amount: Number(koboOf(p)),
    currency: "NGN",
    data: p.data ?? null,
    validity: p.validity ?? null,
  };
}

/** The plans (data bundles, TV bouquets) a biller sells today. Live plans come from the provider's own list. */
export async function listBillPlans(mode: Mode, q: URLSearchParams) {
  const service = q.get("service");
  const billerId = q.get("biller_id");
  if (service !== "data" && service !== "cabletv") {
    throw new V1Error(400, "service must be data or cabletv: only those sell plans.", "validation_error", "service");
  }
  if (!billerId || !getBiller(service, billerId)) throw new V1Error(404, "No such biller for this service.", "not_found", "biller_id");
  const plans =
    mode === "test"
      ? getServiceConfig(service)!.plans
      : ((await getBillCatalog()).find((s) => s.service === service)?.plans ?? []);
  return { object: "list", data: plans.filter((p) => p.billerId === billerId).map(planObject), has_more: false };
}

// ---------------------------------------------------------------------------
// Validation

export async function validateBillCustomer(ctx: ApiContext<z.infer<typeof billValidateSchema>>): Promise<HandlerResult> {
  const b = ctx.body;
  const biller = getBiller(b.service, b.biller_id);
  if (!biller) throw new V1Error(404, "No such biller for this service.", "not_found", "biller_id");
  const customer = normaliseBillCustomer(b.service, b.customer);
  const base = { object: "bill_customer_validation", service: b.service, biller_id: biller.id, customer: customer ?? b.customer };
  if (!customer) return { body: { ...base, valid: false, customer_name: null } };

  if (ctx.mode === "test") {
    const valid = !customer.endsWith("0000");
    return { body: { ...base, valid, customer_name: valid ? "Ada Test" : null } };
  }

  await assertBillsOpen();
  const psp = liveProvider();
  const code = providerBillerCode(biller, psp.name, "pay");
  if (!code && psp.name !== "mock") throw new V1Error(503, `${biller.name} can't be paid right now.`, "biller_unavailable", "biller_id");
  try {
    const r = await psp.validateBillCustomer({ billerCode: code, customer });
    return { body: { ...base, valid: r.valid, customer_name: r.valid ? (r.customerName ?? null) : null } };
  } catch (err) {
    if (err instanceof BillPaymentError && (err.providerStatus === undefined || (err.providerStatus >= 400 && err.providerStatus < 500))) {
      return { body: { ...base, valid: false, customer_name: null } };
    }
    throw new V1Error(503, "The biller couldn't be reached to check this customer. Retry shortly.", "service_unavailable");
  }
}

// ---------------------------------------------------------------------------
// Payment

interface Order {
  service: ApiBillService;
  billerId: string;
  billerName: string;
  billerCode: string | undefined;
  customer: string;
  amountMinor: bigint;
  /** What the provider is sent, in naira ("500", "2500.50"). */
  amountNaira: string;
  planId: string | null;
  planName: string | null;
  planCode: string | undefined;
}

async function resolveOrder(mode: Mode, b: z.infer<typeof billPaymentSchema>, providerName: string | null): Promise<Order> {
  const cfg = getServiceConfig(b.service)!;
  const biller = getBiller(b.service, b.biller_id);
  if (!biller) throw new V1Error(404, "No such biller for this service.", "not_found", "biller_id");
  const customer = normaliseBillCustomer(b.service, b.customer);
  if (!customer) {
    throw new V1Error(
      400,
      PHONE_SERVICES.has(b.service) ? "customer must be a Nigerian phone number." : "customer must be the meter or smartcard number (digits only).",
      "validation_error",
      "customer",
    );
  }
  const billerCode = providerName ? providerBillerCode(biller, providerName, "pay") : undefined;
  if (providerName && !billerCode && providerName !== "mock") {
    throw new V1Error(503, `${biller.name} can't be paid right now.`, "biller_unavailable", "biller_id");
  }

  if (cfg.variableAmount) {
    if (b.plan_id) throw new V1Error(400, `${cfg.label} takes an amount, not a plan.`, "validation_error", "plan_id");
    if (b.amount === undefined) throw new V1Error(400, "amount is required for this service.", "validation_error", "amount");
    if (b.amount % 100 !== 0) throw new V1Error(400, "Bill amounts are whole naira (a multiple of 100 kobo).", "validation_error", "amount");
    return {
      service: b.service,
      billerId: biller.id,
      billerName: biller.name,
      billerCode,
      customer,
      amountMinor: BigInt(b.amount),
      amountNaira: String(b.amount / 100),
      planId: null,
      planName: null,
      planCode: undefined,
    };
  }

  if (!b.plan_id) throw new V1Error(400, "plan_id is required for this service. List plans with GET /v1/bills/plans.", "validation_error", "plan_id");
  const plan = mode === "test" ? getPlan(b.service, b.plan_id) : await getLivePlan(b.service, b.plan_id);
  if (!plan || plan.billerId !== biller.id) throw new V1Error(404, "No such plan for this biller.", "not_found", "plan_id");
  const planMinor = koboOf(plan);
  // `amount` is optional with a plan; when sent, it guards against a price that
  // changed since the developer listed the plans.
  if (b.amount !== undefined && BigInt(b.amount) !== planMinor) {
    throw new V1Error(409, `This plan now costs ${planMinor} kobo. List plans again and confirm the new price.`, "price_changed", "amount");
  }
  return {
    service: b.service,
    billerId: biller.id,
    billerName: biller.name,
    billerCode,
    customer,
    amountMinor: planMinor,
    amountNaira: plan.amount,
    planId: plan.id,
    planName: plan.name,
    planCode: plan.providerCode,
  };
}

type Outcome =
  | { kind: "successful"; providerRef: string | null; token: string | null }
  | { kind: "failed"; providerRef: string | null }
  | { kind: "refused"; message: string | null }
  | { kind: "pending"; providerRef: string | null };

/** A provider error that means nothing was bought: it refused (4xx), or we never sent the request. */
export function isDefiniteBillRefusal(err: unknown): boolean {
  if (!(err instanceof BillPaymentError)) return false;
  const s = err.providerStatus;
  return s === undefined || (s >= 400 && s < 500);
}

async function submitLive(psp: BillsProvider, order: Order, txId: string, accountId: string): Promise<Outcome> {
  try {
    const r = await psp.payBill({
      service: order.service,
      billerCode: order.billerCode,
      planCode: order.planCode,
      customer: order.customer,
      amount: order.amountNaira,
      reference: txId,
    });
    if (r.status === "successful") return { kind: "successful", providerRef: r.providerRef || null, token: r.token ?? null };
    if (r.status === "failed") return { kind: "failed", providerRef: r.providerRef || null };
    return { kind: "pending", providerRef: r.providerRef || null };
  } catch (err) {
    if (isDefiniteBillRefusal(err)) {
      const msg = err instanceof BillPaymentError ? err.providerMessage ?? null : null;
      return { kind: "refused", message: msg ? scrubProviderNames(msg).slice(0, 200) : null };
    }
    console.error("[devapi] bill outcome unknown — left pending", { transaction: txId, error: err instanceof Error ? err.message : String(err) });
    await alertOpsOnce(
      `devapi-bill-unknown:${txId}`,
      "⚠️ Developer API: a live bill payment's outcome is unknown (the provider didn't answer clearly). It is pending; the requery sweep will settle it, or check the provider and settle it by hand.",
      { developer_account: accountId, service: order.service, biller: order.billerId },
    );
    return { kind: "pending", providerRef: null };
  }
}

export async function createBillPayment(ctx: ApiContext<z.infer<typeof billPaymentSchema>>, initiatorIp: string | null): Promise<HandlerResult> {
  const b = ctx.body;
  const walletId = b.wallet_id ? resolveId("wallet", b.wallet_id, "wallet_id", "wallet") : null;

  return runIdempotent(ctx, b, {
    replay: async (id) => {
      const tx = (await getTransaction(prisma, ctx.scope, id))!;
      return { status: tx.status === "pending" ? 202 : 201, body: transactionObject(tx) };
    },
    work: async (complete) => {
      const live = ctx.mode === "live";
      if (live) await assertBillsOpen();
      // Resolve the provider before any money moves: a misconfiguration refuses here, cleanly.
      const psp = live ? liveProvider() : null;
      const order = await resolveOrder(ctx.mode, b, psp?.name ?? null);
      const fee = billFee(ctx.plan, order.amountMinor);
      const total = order.amountMinor + fee;
      const limits = live ? effectiveLimits(ctx.account, await getDevLimits()) : null;

      let txId: string;
      try {
        txId = await prisma.$transaction(async (db) => {
          let wallet;
          if (walletId) {
            wallet = await getWallet(db, ctx.scope, walletId);
            if (!wallet) throw new V1Error(404, "No such wallet.", "not_found", "wallet_id");
          } else {
            await ensureMainWallets(db, ctx.scope.accountId, ctx.scope.mode);
            wallet = (await getMainWallet(db, ctx.scope.accountId, ctx.scope.mode, "NGN"))!;
          }
          if (wallet.currency !== "NGN") {
            throw new V1Error(400, `Bills are paid in naira; that wallet holds ${wallet.currency}.`, "currency_mismatch", "wallet_id");
          }
          if (limits) await assertWithinOutflowLimits(db, ctx.account, "NGN", total, limits);
          const id = await insertTransaction(db, {
            accountId: ctx.scope.accountId,
            mode: ctx.scope.mode,
            kind: "bill_payment",
            status: "pending",
            currency: "NGN",
            amountMinor: order.amountMinor,
            feeMinor: fee,
            walletId: wallet.id,
            customerId: wallet.customer_id,
            reference: b.reference ?? null,
            description: b.description ?? null,
            metadata: b.metadata ?? {},
            details: {
              service: order.service,
              biller_id: order.billerId,
              biller_name: order.billerName,
              customer: order.customer,
              plan_id: order.planId,
              plan_name: order.planName,
              bills_provider: psp?.name ?? "sandbox",
            },
            initiatorIp,
          });
          await applyLegs(db, ctx.scope, id, "NGN", [
            { walletId: wallet.id, amountMinor: -order.amountMinor, kind: "bill_payment" },
            { walletId: wallet.id, amountMinor: -fee, kind: "fee" },
          ]);
          await complete(db, "transaction", id, 202);
          return id;
        }, MONEY_TX);
      } catch (err) {
        if (uniqueViolation(err)?.includes("reference")) {
          throw new V1Error(409, "Another transaction already uses this reference.", "duplicate_reference", "reference");
        }
        throw err;
      }

      let outcome: Outcome;
      if (psp) {
        outcome = await submitLive(psp, order, txId, ctx.scope.accountId);
      } else {
        const sim = sandboxOutcome(order.customer);
        const ref = `test_${txId.replace(/-/g, "")}`;
        outcome =
          sim === "successful"
            ? { kind: "successful", providerRef: ref, token: order.service === "electricity" ? SANDBOX_TOKEN : null }
            : sim === "failed"
              ? { kind: "failed", providerRef: ref }
              : { kind: "pending", providerRef: ref };
      }
      const settled = await applyOutcome(txId, outcome);
      return { status: settled.status === "pending" ? 202 : 201, body: transactionObject(settled) };
    },
  });
}

async function applyOutcome(txId: string, o: Outcome): Promise<DevTransactionRow> {
  switch (o.kind) {
    case "successful":
      return (await completeBill(txId, { providerRef: o.providerRef, token: o.token })) ?? (await billRow(txId))!;
    case "failed":
      if (o.providerRef) await setProviderRef(txId, o.providerRef);
      return (
        (await failBill(txId, "bill_failed", "The biller did not accept this payment. The amount and fee were returned to the wallet.")) ??
        (await billRow(txId))!
      );
    case "refused":
      return (
        (await failBill(
          txId,
          "bill_refused",
          `The payment was refused${o.message ? `: ${o.message.replace(/\.$/, "")}` : ""}. The amount and fee were returned to the wallet.`,
        )) ?? (await billRow(txId))!
      );
    case "pending":
      if (o.providerRef) await setProviderRef(txId, o.providerRef);
      return (await billRow(txId))!;
  }
}

async function billRow(txId: string): Promise<DevTransactionRow | null> {
  const rows = await prisma.$queryRawUnsafe<DevTransactionRow[]>(
    `SELECT * FROM dev_transactions WHERE id = $1::uuid AND kind = 'bill_payment'`,
    txId,
  );
  return rows[0] ?? null;
}

async function setProviderRef(txId: string, providerRef: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE dev_transactions SET provider_ref = $2, updated_at = now() WHERE id = $1::uuid AND provider_ref IS NULL`,
    txId,
    providerRef,
  );
}

/**
 * Mark a pending bill successful and send bill_payment.successful. Guarded on
 * the row still being pending, so a webhook, the sweep and the synchronous
 * answer can all arrive and only the first acts. Null if it was already settled.
 */
export async function completeBill(txId: string, extra: { providerRef?: string | null; token?: string | null } = {}): Promise<DevTransactionRow | null> {
  const token = extra.token?.trim() || null;
  let eventId: string | null = null;
  const row = await prisma.$transaction(async (db) => {
    const moved = await db.$queryRawUnsafe<{ account_id: string; mode: Mode }[]>(
      `UPDATE dev_transactions SET status = 'successful', completed_at = now(), updated_at = now(),
          provider_ref = COALESCE(provider_ref, $2),
          details = CASE WHEN $3::text IS NULL THEN details ELSE details || jsonb_build_object('token', $3::text) END
        WHERE id = $1::uuid AND kind = 'bill_payment' AND status = 'pending'
        RETURNING account_id, mode`,
      txId,
      extra.providerRef ?? null,
      token,
    );
    if (!moved[0]) return null;
    const scope = { accountId: moved[0].account_id, mode: moved[0].mode };
    const tx = (await getTransaction(db, scope, txId))!;
    eventId = await recordEvent(db, { accountId: scope.accountId, mode: scope.mode, type: "bill_payment.successful", object: transactionObject(tx) });
    return tx;
  }, MONEY_TX);
  if (eventId) deliverSoon([eventId]);
  return row;
}

/**
 * Mark a pending bill failed, give back the amount AND the fee, and send
 * bill_payment.failed. Guarded like completeBill; null if already settled.
 */
export async function failBill(txId: string, code: string, message: string): Promise<DevTransactionRow | null> {
  let eventId: string | null = null;
  const row = await prisma.$transaction(async (db) => {
    const moved = await db.$queryRawUnsafe<{ account_id: string; mode: Mode; wallet_id: string; amount_minor: bigint; fee_minor: bigint }[]>(
      `UPDATE dev_transactions SET status = 'failed', failure_code = $2, failure_message = $3, completed_at = now(), updated_at = now()
        WHERE id = $1::uuid AND kind = 'bill_payment' AND status = 'pending'
        RETURNING account_id, mode, wallet_id, amount_minor, fee_minor`,
      txId,
      code,
      message,
    );
    const m = moved[0];
    if (!m) return null;
    const scope = { accountId: m.account_id, mode: m.mode };
    await applyLegs(db, scope, txId, "NGN", [
      { walletId: m.wallet_id, amountMinor: m.amount_minor, kind: "bill_refund" },
      { walletId: m.wallet_id, amountMinor: m.fee_minor, kind: "fee_refund" },
    ]);
    const tx = (await getTransaction(db, scope, txId))!;
    eventId = await recordEvent(db, { accountId: scope.accountId, mode: scope.mode, type: "bill_payment.failed", object: transactionObject(tx) });
    return tx;
  }, MONEY_TX);
  if (eventId) deliverSoon([eventId]);
  return row;
}

// ---------------------------------------------------------------------------
// Settlement from outside the request

export type ApiBillSettlement = { outcome: "completed" | "refunded" | "duplicate"; transactionId: string };

/**
 * The provider's webhook, for a bill no app user owns: settle the developer's
 * live bill with this reference (vtu.ng echoes our transaction id; the NGN
 * rail sends its own id, which we stored as provider_ref). Null if no
 * developer bill matches either.
 */
export async function settleApiBill(
  providerRef: string,
  outcome: "successful" | "failed",
  extra: { token?: string | null } = {},
): Promise<ApiBillSettlement | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerRef);
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM dev_transactions
      WHERE kind = 'bill_payment' AND mode = 'live' AND (provider_ref = $1 OR ($2::uuid IS NOT NULL AND id = $2::uuid))
      LIMIT 1`,
    providerRef,
    isUuid ? providerRef : null,
  );
  const id = rows[0]?.id;
  if (!id) return null;
  const done =
    outcome === "successful"
      ? await completeBill(id, { token: extra.token ?? null })
      : await failBill(id, "bill_failed", "The biller did not complete this payment. The amount and fee were returned to the wallet.");
  return { outcome: done ? (outcome === "successful" ? "completed" : "refunded") : "duplicate", transactionId: id };
}

/** Test mode: settle a pending sandbox bill (a customer ending in 1111) as successful or failed. */
export async function settleTestBill(scope: { accountId: string; mode: Mode }, txId: string, outcome: "successful" | "failed"): Promise<DevTransactionRow> {
  const tx = await getTransaction(prisma, scope, txId);
  if (!tx || tx.kind !== "bill_payment" || scope.mode !== "test") throw new V1Error(404, "No such bill payment.", "not_found", "id");
  if (tx.status !== "pending") return tx;
  const service = (tx.details as Record<string, unknown>)?.service;
  const done =
    outcome === "successful"
      ? await completeBill(txId, { token: service === "electricity" ? SANDBOX_TOKEN : null })
      : await failBill(txId, "bill_failed", "The biller did not accept this payment. The amount and fee were returned to the wallet.");
  return done ?? (await getTransaction(prisma, scope, txId))!;
}

/**
 * The safety net for webhooks that never came: ask the provider about live
 * bills still pending after a few minutes, and settle what it answers. Only
 * providers with a requery (vtu.ng) can be asked; the others are reported to
 * ops once they're an hour old. Never throws.
 */
export async function sweepPendingApiBills(opts: { olderThanMs?: number; limit?: number; now?: Date } = {}): Promise<{ checked: number; settled: number }> {
  const now = opts.now ?? new Date();
  try {
    const rows = await prisma.$queryRawUnsafe<DevTransactionRow[]>(
      `SELECT * FROM dev_transactions
        WHERE kind = 'bill_payment' AND mode = 'live' AND status = 'pending' AND created_at < $1
        ORDER BY created_at ASC LIMIT $2`,
      new Date(now.getTime() - (opts.olderThanMs ?? 5 * 60_000)),
      opts.limit ?? 25,
    );
    let settled = 0;
    for (const tx of rows) {
      const providerName = String((tx.details as Record<string, unknown>)?.bills_provider ?? "");
      const ageMs = now.getTime() - tx.created_at.getTime();
      const psp = providerName === "vtung" ? billsProviderNamed("vtung") : null;
      if (!psp?.queryBill) {
        if (ageMs > 60 * 60_000) {
          await alertOpsOnce(
            `devapi-bill-stuck:${tx.id}`,
            "⚠️ Developer API: a live bill payment has been pending for over an hour and its provider can't be asked. Check it and settle it by hand.",
            { developer_account: tx.account_id, provider: providerName || "unknown" },
          );
        }
        continue;
      }
      try {
        const q = await psp.queryBill(tx.id);
        let done: DevTransactionRow | null = null;
        if (q.status === "successful") done = await completeBill(tx.id, { token: q.token ?? null });
        else if (q.status === "failed") {
          done = await failBill(tx.id, "bill_failed", "The biller did not complete this payment. The amount and fee were returned to the wallet.");
        } else if (q.status === "not_found" && ageMs > NOT_FOUND_REFUND_AFTER_MS) {
          done = await failBill(tx.id, "bill_not_received", "The biller never received this payment. The amount and fee were returned to the wallet.");
        }
        if (done) settled += 1;
      } catch (err) {
        console.error("[devapi] bill requery failed", { transaction: tx.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { checked: rows.length, settled };
  } catch (err) {
    console.error("[devapi] bill sweep failed", err);
    return { checked: 0, settled: 0 };
  }
}
