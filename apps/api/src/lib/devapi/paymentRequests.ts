// apps/api/src/lib/devapi/paymentRequests.ts
//
// Payment requests: a one-off NGN account number for one expected payment, paid
// by anyone. Unlike a virtual account there is no customer and no identity
// check on the payer: the account belongs to the developer (who passed review
// to go live), so it suits "pay ₦2,000 for a subscription" checkouts.
//
// Live accounts are Maplerad dynamic accounts (POST /collections/dynamic-account).
// Money that arrives is credited to the developer's main NGN wallet as a
// `payment` transaction, less the plan's deposit fee, exactly once per partner
// transaction, and sends payment_request.paid. A request nobody paid expires
// (payment_request.expired); money that still arrives afterwards is credited:
// it has arrived, so it is recorded.
//
// The row is claimed ('creating') before the partner is called, so a request
// that dies half-way is visible and is failed by the sweep, never left pending
// with no account number.

import { randomInt, randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@cheqpay/db";
import { z } from "zod";
import { fromPublicId, toPublicId } from "@cheqpay/devapi";
import { ApiError } from "../http";
import { getFeatureFlags } from "../features";
import { checkRateLimit } from "../ratelimit";
import { createDynamicAccount } from "../maplerad/accounts";
import { minor } from "../maplerad/types";
import type { CreditResult } from "../maplerad/deposits";
import type { VerifiedTransaction } from "../maplerad/transactions";
import { V1Error, type ApiContext, type HandlerResult } from "./handler";
import { ensureDevApiSchema } from "./ensureDevApi";
import { applyLegs, ensureMainWallets, getMainWallet } from "./ledger";
import { recordEvent } from "./events";
import { deliverSoon } from "./webhooks";
import { depositFee, planFor, type Payer } from "./deposits";
import { descriptionSchema, metadataSchema, referenceSchema, uniqueViolation } from "./inputs";
import { listParams, type Page, type Scope } from "./lists";
import { runIdempotent } from "./idempotency";
import { SANDBOX_BANK } from "./virtualAccounts";
import type { Mode, PaymentRequestRow } from "./types";

const MONEY_TX = { maxWait: 10_000, timeout: 15_000 };

/** ₦100 to ₦10,000,000, in kobo. */
export const MIN_PAYMENT_REQUEST_MINOR = 10_000;
export const MAX_PAYMENT_REQUEST_MINOR = 1_000_000_000;

export const paymentRequestCreateSchema = z
  .object({
    amount: z
      .number({ invalid_type_error: "Send the amount as a number in kobo" })
      .int("Amounts are whole numbers in kobo")
      .min(MIN_PAYMENT_REQUEST_MINOR, "A payment request is at least ₦100 (10000 kobo)")
      .max(MAX_PAYMENT_REQUEST_MINOR, "A payment request is at most ₦10,000,000 (1000000000 kobo)"),
    account_name: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9 &.\-]+$/, "Use letters, digits, spaces and - & . only")
      .optional(),
    description: descriptionSchema.optional(),
    expires_in: z.number().int().min(900, "At least 900 seconds (15 minutes)").max(86_400, "At most 86400 seconds (24 hours)").default(3_600),
    reference: referenceSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const paymentRequestPaySchema = z
  .object({
    amount: z.number().int().positive().max(MAX_PAYMENT_REQUEST_MINOR).optional(),
    sender_name: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{M} .'’-]+$/u, "Letters only").optional(),
  })
  .strict();

const n = (v: bigint | number) => Number(v);

export function paymentRequestObject(p: PaymentRequestRow) {
  return {
    object: "payment_request",
    id: toPublicId("payment_request", p.id),
    // 'creating' and 'failed' never reach a developer: a request is answered
    // only once it has an account number, and a failed one returns an error.
    status: p.status === "paid" ? "paid" : p.status === "expired" ? "expired" : "pending",
    currency: p.currency,
    amount: n(p.amount_minor),
    amount_paid: n(p.amount_paid_minor),
    fee: n(p.fee_minor),
    account_number: p.account_number,
    bank_name: p.bank_name,
    account_name: p.account_name,
    description: p.description,
    transaction_id: p.transaction_id ? toPublicId("transaction", p.transaction_id) : null,
    reference: p.reference,
    metadata: p.metadata ?? {},
    livemode: p.mode === "live",
    expires_at: p.expires_at.toISOString(),
    paid_at: p.paid_at ? p.paid_at.toISOString() : null,
    created_at: p.created_at.toISOString(),
  };
}

export async function getPaymentRequest(scope: Scope, id: string): Promise<PaymentRequestRow | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<PaymentRequestRow[]>(
    `SELECT * FROM dev_payment_requests WHERE id = $1::uuid AND account_id = $2::uuid AND mode = $3 AND status IN ('pending', 'paid', 'expired')`,
    id,
    scope.accountId,
    scope.mode,
  );
  return rows[0] ?? null;
}

export async function listPaymentRequests(scope: Scope, q: URLSearchParams): Promise<Page<PaymentRequestRow>> {
  await ensureDevApiSchema();
  const { limit, startingAfter } = listParams(q);
  const status = q.get("status");
  if (status !== null && !["pending", "paid", "expired"].includes(status)) {
    throw new V1Error(400, "status must be pending, paid or expired.", "validation_error", "status");
  }
  const after = startingAfter ? fromPublicId("payment_request", startingAfter) : null;
  if (startingAfter && !after) throw new V1Error(400, "starting_after must be a payment request id.", "validation_error", "starting_after");
  const rows = await prisma.$queryRawUnsafe<PaymentRequestRow[]>(
    `SELECT * FROM dev_payment_requests p
      WHERE p.account_id = $1::uuid AND p.mode = $2 AND p.status IN ('pending', 'paid', 'expired')
        AND ($3::text IS NULL OR p.status = $3)
        AND ($4::text IS NULL OR p.reference = $4)
        AND ($5::uuid IS NULL OR (p.created_at, p.id) < (SELECT x.created_at, x.id FROM dev_payment_requests x
              WHERE x.id = $5::uuid AND x.account_id = $1::uuid AND x.mode = $2))
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $6`,
    scope.accountId,
    scope.mode,
    status,
    q.get("reference"),
    after,
    limit + 1,
  );
  return { object: "list", data: rows.slice(0, limit), has_more: rows.length > limit };
}

interface Opened {
  accountNumber: string;
  bankName: string;
  accountName: string;
  providerAccountId: string | null;
}

/** What the payer sees as the account name: the business, then what the developer called this payment. */
export function payerFacingName(businessName: string, accountName: string | undefined): string {
  const business = businessName.replace(/[^A-Za-z0-9 &.\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "CheqPay";
  return accountName ? `${business} / ${accountName}`.slice(0, 80) : business;
}

/** A sandbox account number: 10 digits starting 99, so it can never be mistaken for a real one. */
function sandboxAccount(name: string): Opened {
  return { accountNumber: `99${String(randomInt(0, 100_000_000)).padStart(8, "0")}`, bankName: SANDBOX_BANK, accountName: name, providerAccountId: null };
}

async function openLiveAccount(name: string, amountMinor: number): Promise<Opened> {
  // Maplerad requires the bank that mints a dynamic account; there is no default.
  const bank = process.env.MAPLERAD_DYNAMIC_ACCOUNT_BANK || process.env.MAPLERAD_PREFERRED_BANK;
  if (!bank) throw new V1Error(503, "Payment requests aren't available in live mode yet.", "feature_disabled");
  const va = await createDynamicAccount({ accountName: name, preferredBank: bank, amount: minor(amountMinor) });
  if (!va?.id || !/^\d{10}$/.test(va.account_number ?? "")) throw new Error("the partner returned no usable account number");
  return { accountNumber: va.account_number, bankName: va.bank_name, accountName: va.account_name || name, providerAccountId: va.id };
}

export async function createPaymentRequest(ctx: ApiContext<z.infer<typeof paymentRequestCreateSchema>>): Promise<HandlerResult> {
  await ensureDevApiSchema();
  return runIdempotent(ctx, ctx.body, {
    replay: async (id) => ({ body: paymentRequestObject((await getPaymentRequest(ctx.scope, id))!) }),
    work: async (complete) => {
      if (ctx.mode === "live") {
        if (!(await getFeatureFlags()).ngn_deposits) {
          throw new V1Error(503, "Payment requests are temporarily unavailable.", "feature_disabled");
        }
        const pace = await checkRateLimit(`devapi:pr:${ctx.scope.accountId}`, 60, 60_000);
        if (!pace.allowed) {
          throw new V1Error(429, "Too many payment requests in a minute. Slow down and retry.", "rate_limited", null, Math.max(1, Math.ceil((pace.resetAt - Date.now()) / 1000)));
        }
      }

      const id = randomUUID();
      const name = payerFacingName(ctx.account.business_name, ctx.body.account_name);
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO dev_payment_requests (id, account_id, mode, status, amount_minor, description, reference, metadata, expires_at)
           VALUES ($1::uuid, $2::uuid, $3, 'creating', $4, $5, $6, $7::jsonb, now() + make_interval(secs => $8::int))`,
          id,
          ctx.scope.accountId,
          ctx.scope.mode,
          BigInt(ctx.body.amount),
          ctx.body.description ?? null,
          ctx.body.reference ?? null,
          JSON.stringify(ctx.body.metadata ?? {}),
          ctx.body.expires_in,
        );
      } catch (err) {
        if ((uniqueViolation(err) ?? []).includes("reference")) {
          throw new V1Error(409, "Another payment request already uses this reference.", "duplicate_reference", "reference");
        }
        throw err;
      }

      let opened: Opened;
      try {
        opened = ctx.mode === "test" ? sandboxAccount(name) : await openLiveAccount(name, ctx.body.amount);
      } catch (err) {
        const reason = err instanceof Error ? err.message.slice(0, 200) : "unknown";
        await prisma.$executeRawUnsafe(
          `UPDATE dev_payment_requests SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1::uuid`,
          id,
          reason,
        );
        if (err instanceof ApiError) throw err;
        console.error("[devapi] payment request not opened", { payment_request: id, reason });
        throw new V1Error(503, "The account number couldn't be created right now. Nothing was charged; retry shortly.", "service_unavailable");
      }

      const row = await prisma.$transaction(async (db) => {
        const rows = await db.$queryRawUnsafe<PaymentRequestRow[]>(
          `UPDATE dev_payment_requests SET status = 'pending', account_number = $2, bank_name = $3, account_name = $4,
              provider_account_id = $5, updated_at = now()
            WHERE id = $1::uuid RETURNING *`,
          id,
          opened.accountNumber,
          opened.bankName,
          opened.accountName,
          opened.providerAccountId,
        );
        await complete(db, "payment_request", id, 201);
        return rows[0];
      });
      return { status: 201, body: paymentRequestObject(row) };
    },
  });
}

/** Credit money that arrived for a payment request. Safe to call again for the same provider reference. */
export async function creditPaymentRequest(input: {
  requestId: string;
  providerRef: string;
  amountMinor: bigint;
  payer: Payer;
  within?: (db: Prisma.TransactionClient, requestId: string) => Promise<void>;
}): Promise<{ outcome: "credited" | "duplicate"; request: PaymentRequestRow }> {
  if (input.amountMinor <= 0n) throw new Error("payment amount must be positive");
  const found = await prisma.$queryRawUnsafe<PaymentRequestRow[]>(`SELECT * FROM dev_payment_requests WHERE id = $1::uuid`, input.requestId);
  const pr = found[0];
  if (!pr || !["pending", "paid", "expired"].includes(pr.status)) throw new Error("no such open payment request");
  const plan = await planFor(pr.account_id, pr.mode);
  const fee = depositFee(plan, input.amountMinor);
  const scope = { accountId: pr.account_id, mode: pr.mode };
  const payerName = input.payer.name?.trim().slice(0, 120) || null;
  const details = {
    payment_request_id: toPublicId("payment_request", pr.id),
    payer: {
      name: payerName,
      bank_name: input.payer.bank_name?.trim().slice(0, 80) || null,
      account_number_last4: input.payer.account_number ? input.payer.account_number.replace(/\D/g, "").slice(-4) || null : null,
    },
  };

  let eventId: string | null = null;
  const result = await prisma.$transaction(async (db) => {
    // One credit at a time per request, so amount_paid adds up exactly.
    await db.$queryRawUnsafe(`SELECT id FROM dev_payment_requests WHERE id = $1::uuid FOR UPDATE`, pr.id);
    await ensureMainWallets(db, pr.account_id, pr.mode);
    const wallet = (await getMainWallet(db, pr.account_id, pr.mode, "NGN"))!;
    const txId = randomUUID();
    const inserted = await db.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO dev_transactions (id, account_id, mode, kind, status, currency, amount_minor, fee_minor,
         wallet_id, description, details, provider_ref, completed_at)
       VALUES ($1::uuid, $2::uuid, $3, 'payment', 'successful', 'NGN', $4, $5, $6::uuid, $7, $8::jsonb, $9, now())
       ON CONFLICT (provider_ref) WHERE kind = 'payment' DO NOTHING
       RETURNING id`,
      txId,
      pr.account_id,
      pr.mode,
      input.amountMinor,
      fee,
      wallet.id,
      payerName ? `Payment from ${payerName}` : "Payment by bank transfer",
      JSON.stringify(details),
      input.providerRef,
    );
    if (!inserted.length) {
      const again = await db.$queryRawUnsafe<PaymentRequestRow[]>(`SELECT * FROM dev_payment_requests WHERE id = $1::uuid`, pr.id);
      return { outcome: "duplicate" as const, request: again[0] };
    }
    const net = input.amountMinor - fee;
    if (net > 0n) await applyLegs(db, scope, txId, "NGN", [{ walletId: wallet.id, amountMinor: net, kind: "payment" }]);
    const rows = await db.$queryRawUnsafe<PaymentRequestRow[]>(
      `UPDATE dev_payment_requests SET status = 'paid', amount_paid_minor = amount_paid_minor + $2, fee_minor = fee_minor + $3,
          paid_at = COALESCE(paid_at, now()), transaction_id = COALESCE(transaction_id, $4::uuid), updated_at = now()
        WHERE id = $1::uuid RETURNING *`,
      pr.id,
      input.amountMinor,
      fee,
      txId,
    );
    if (input.within) await input.within(db, pr.id);
    eventId = await recordEvent(db, { accountId: pr.account_id, mode: pr.mode, type: "payment_request.paid", object: paymentRequestObject(rows[0]) });
    return { outcome: "credited" as const, request: rows[0] };
  }, MONEY_TX);

  if (eventId) deliverSoon([eventId]);
  return result;
}

/** Sandbox: pretend the payer sent the money. Defaults to exactly the requested amount. */
export async function simulatePaymentRequestPayment(
  scope: { accountId: string; mode: Mode },
  requestId: string,
  body: z.infer<typeof paymentRequestPaySchema>,
  within?: (db: Prisma.TransactionClient, requestId: string) => Promise<void>,
): Promise<PaymentRequestRow> {
  const pr = await getPaymentRequest(scope, requestId);
  if (!pr || pr.mode !== "test") throw new V1Error(404, "No such payment request.", "not_found", "id");
  const r = await creditPaymentRequest({
    requestId: pr.id,
    providerRef: `test_${randomUUID()}`,
    amountMinor: BigInt(body.amount ?? pr.amount_minor),
    payer: { name: body.sender_name ?? "Test Payer", bank_name: "CheqPay Test Bank", account_number: "0123456789" },
    within,
  });
  return r.request;
}

/**
 * The fall-through from the collection webhook, after app users and developer
 * virtual accounts: credit a verified transfer into a live payment request's
 * account number, or return null when it isn't one.
 */
export async function settleDevPaymentRequest(tx: VerifiedTransaction): Promise<CreditResult | null> {
  await ensureDevApiSchema();
  if ((tx.currency ?? "NGN").toUpperCase() !== "NGN" || !tx.account_id) return null;
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM dev_payment_requests WHERE mode = 'live' AND provider_account_id = $1 AND status IN ('pending', 'paid', 'expired')`,
    tx.account_id,
  );
  if (!rows[0]) return null;
  const r = await creditPaymentRequest({
    requestId: rows[0].id,
    providerRef: tx.id,
    amountMinor: BigInt(tx.amount),
    payer: { name: tx.source?.account_name, account_number: tx.source?.account_number, bank_name: tx.source?.bank_name },
  });
  return { outcome: r.outcome, amount: tx.amount, reason: "developer payment request" };
}

/**
 * Expire unpaid requests past their time (payment_request.expired), and fail
 * any claim whose request died before it got an account number.
 */
export async function expireDuePaymentRequests(limit = 500): Promise<{ expired: number; abandoned: number }> {
  await ensureDevApiSchema();
  const abandoned = await prisma.$executeRawUnsafe(
    `UPDATE dev_payment_requests SET status = 'failed', failure_reason = 'abandoned', updated_at = now()
      WHERE status = 'creating' AND updated_at < now() - interval '5 minutes'`,
  );
  const eventIds: string[] = [];
  const expired = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRawUnsafe<PaymentRequestRow[]>(
      `UPDATE dev_payment_requests SET status = 'expired', updated_at = now()
        WHERE id IN (SELECT id FROM dev_payment_requests WHERE status = 'pending' AND expires_at <= now()
                     ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      limit,
    );
    for (const r of rows) {
      eventIds.push(await recordEvent(db, { accountId: r.account_id, mode: r.mode, type: "payment_request.expired", object: paymentRequestObject(r) }));
    }
    return rows.length;
  }, MONEY_TX);
  if (eventIds.length) deliverSoon(eventIds);
  return { expired, abandoned: Number(abandoned) };
}

