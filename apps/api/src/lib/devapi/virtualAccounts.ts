// apps/api/src/lib/devapi/virtualAccounts.ts
//
// Virtual accounts: a dedicated NGN bank account number for one verified
// customer. Transfers into it credit that customer's NGN wallet (deposits.ts).
//
// One per customer: asking again returns the account that already exists. The
// row is claimed ('creating') before the partner is called, under a unique
// index, so two requests racing for the same customer can't open two accounts;
// and a retry after a lost response first adopts any account the partner did
// open, rather than opening a second.

import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "@cheqpay/db";
import { z } from "zod";
import { fromPublicId, toPublicId } from "@cheqpay/devapi";
import { ApiError } from "../http";
import { getFeatureFlags } from "../features";
import { checkRateLimit } from "../ratelimit";
import { createStaticAccount, getCustomerVirtualAccounts } from "../maplerad/accounts";
import { V1Error, type ApiContext, type HandlerResult } from "./handler";
import { ensureDevApiSchema } from "./ensureDevApi";
import { ensureCustomerWallets, getCustomerWallet } from "./ledger";
import { getCustomer } from "./customers";
import { recordEvent } from "./events";
import { deliverSoon } from "./webhooks";
import { metadataSchema, referenceSchema, resolveId, uniqueViolation } from "./inputs";
import { listParams, type Page, type Scope } from "./lists";
import { runIdempotent } from "./idempotency";
import type { CustomerRow, VirtualAccountRow } from "./types";

export const SANDBOX_BANK = "CheqPay Test Bank";

export const virtualAccountCreateSchema = z
  .object({
    customer_id: z.string().max(80),
    reference: referenceSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export function virtualAccountObject(v: VirtualAccountRow) {
  return {
    object: "virtual_account",
    id: toPublicId("virtual_account", v.id),
    customer_id: toPublicId("customer", v.customer_id),
    wallet_id: toPublicId("wallet", v.wallet_id),
    currency: v.currency,
    status: v.status,
    account_number: v.account_number,
    bank_name: v.bank_name,
    account_name: v.account_name,
    reference: v.reference,
    metadata: v.metadata ?? {},
    livemode: v.mode === "live",
    created_at: v.created_at.toISOString(),
  };
}

export async function getVirtualAccount(scope: Scope, id: string): Promise<VirtualAccountRow | null> {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<VirtualAccountRow[]>(
    `SELECT * FROM dev_virtual_accounts WHERE id = $1::uuid AND account_id = $2::uuid AND mode = $3`,
    id,
    scope.accountId,
    scope.mode,
  );
  return rows[0] ?? null;
}

export async function listVirtualAccounts(scope: Scope, q: URLSearchParams): Promise<Page<VirtualAccountRow>> {
  await ensureDevApiSchema();
  const { limit, startingAfter } = listParams(q);
  const customerParam = q.get("customer_id");
  const customer = customerParam === null ? null : fromPublicId("customer", customerParam);
  if (customerParam !== null && !customer) return { object: "list", data: [], has_more: false };
  const after = startingAfter ? fromPublicId("virtual_account", startingAfter) : null;
  if (startingAfter && !after) throw new V1Error(400, "starting_after must be a virtual account id.", "validation_error", "starting_after");
  // Failed attempts are internal history, not something a developer can use.
  const rows = await prisma.$queryRawUnsafe<VirtualAccountRow[]>(
    `SELECT * FROM dev_virtual_accounts v
      WHERE v.account_id = $1::uuid AND v.mode = $2 AND v.status IN ('active', 'closed')
        AND ($3::uuid IS NULL OR v.customer_id = $3::uuid)
        AND ($4::uuid IS NULL OR (v.created_at, v.id) < (SELECT x.created_at, x.id FROM dev_virtual_accounts x
              WHERE x.id = $4::uuid AND x.account_id = $1::uuid AND x.mode = $2))
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT $5`,
    scope.accountId,
    scope.mode,
    customer,
    after,
    limit + 1,
  );
  return { object: "list", data: rows.slice(0, limit), has_more: rows.length > limit };
}

async function openFor(customerId: string): Promise<VirtualAccountRow | null> {
  const rows = await prisma.$queryRawUnsafe<VirtualAccountRow[]>(
    `SELECT * FROM dev_virtual_accounts WHERE customer_id = $1::uuid AND status IN ('creating', 'active')`,
    customerId,
  );
  return rows[0] ?? null;
}

interface Opened {
  accountNumber: string;
  bankName: string;
  accountName: string;
  providerAccountId: string | null;
}

/** A sandbox account number: 10 digits starting 99, so it can never be mistaken for a real one. */
function sandboxAccount(c: CustomerRow): Opened {
  return {
    accountNumber: `99${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
    bankName: SANDBOX_BANK,
    accountName: `${c.first_name} ${c.last_name}`.toUpperCase(),
    providerAccountId: null,
  };
}

async function openLiveAccount(c: CustomerRow): Promise<Opened> {
  if (!c.provider_customer_id) throw new V1Error(409, "The customer must pass identity verification first.", "kyc_required", "customer_id");
  // Adopt an account the partner already opened for this customer — an earlier
  // attempt whose response we never got — so a retry never opens a second one.
  let existing = null;
  try {
    existing = (await getCustomerVirtualAccounts(c.provider_customer_id)).find(
      (a) => (a.currency ?? "NGN") === "NGN" && a.account_number && a.id,
    );
  } catch {
    // Can't list: opening is still safe, the partner allows one per customer.
  }
  const va = existing ?? (await createStaticAccount({ customerId: c.provider_customer_id, currency: "NGN" }));
  if (!va?.id || !/^\d{10}$/.test(va.account_number ?? "")) throw new Error("the partner returned no usable account number");
  return {
    accountNumber: va.account_number,
    bankName: va.bank_name,
    accountName: va.account_name,
    providerAccountId: va.id,
  };
}

export async function createVirtualAccount(ctx: ApiContext<z.infer<typeof virtualAccountCreateSchema>>): Promise<HandlerResult> {
  await ensureDevApiSchema();
  const customerId = resolveId("customer", ctx.body.customer_id, "customer_id", "customer");

  return runIdempotent(ctx, ctx.body, {
    replay: async (id) => ({ status: 201, body: virtualAccountObject((await getVirtualAccount(ctx.scope, id))!) }),
    work: async (complete) => {
      const customer = await getCustomer(ctx.scope, customerId);
      if (!customer) throw new V1Error(404, "No such customer.", "not_found", "customer_id");
      if (customer.kyc_status !== "verified") {
        throw new V1Error(409, "A virtual account needs a verified customer. Wait for customer.verified.", "kyc_required", "customer_id");
      }

      // One per customer: the existing account is the answer.
      let existing = await openFor(customer.id);
      if (existing?.status === "creating" && Date.now() - existing.updated_at.getTime() > 2 * 60_000) {
        // A claim whose request died; free it so this request can open the account.
        await prisma.$executeRawUnsafe(
          `UPDATE dev_virtual_accounts SET status = 'failed', failure_reason = 'abandoned', updated_at = now() WHERE id = $1::uuid AND status = 'creating'`,
          existing.id,
        );
        existing = null;
      }
      if (existing?.status === "active") {
        await prisma.$transaction((db) => complete(db, "virtual_account", existing!.id, 200));
        return { status: 200, body: virtualAccountObject(existing) };
      }
      if (existing) {
        throw new V1Error(409, "A virtual account is already being opened for this customer. Retry in a few seconds.", "virtual_account_in_progress", "customer_id");
      }

      if (ctx.mode === "live") {
        if (!(await getFeatureFlags()).ngn_deposits) {
          throw new V1Error(503, "Virtual accounts are temporarily unavailable.", "feature_disabled");
        }
        const pace = await checkRateLimit(`devapi:va:${ctx.scope.accountId}`, 30, 60_000);
        if (!pace.allowed) {
          throw new V1Error(429, "Too many virtual accounts opened in a minute. Slow down and retry.", "rate_limited", null, Math.max(1, Math.ceil((pace.resetAt - Date.now()) / 1000)));
        }
      }
      const count = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM dev_virtual_accounts WHERE account_id = $1::uuid AND mode = $2 AND status IN ('creating', 'active')`,
        ctx.scope.accountId,
        ctx.scope.mode,
      );
      if (Number(count[0]?.n ?? 0) >= ctx.plan.maxVirtualAccounts) {
        throw new V1Error(403, `Your plan allows ${ctx.plan.maxVirtualAccounts.toLocaleString("en-US")} virtual accounts in ${ctx.mode} mode.`, "plan_limit_reached");
      }

      await ensureCustomerWallets(prisma, ctx.scope.accountId, ctx.scope.mode, customer.id);
      const wallet = (await getCustomerWallet(prisma, customer.id, "NGN"))!;
      const id = randomUUID();
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO dev_virtual_accounts (id, account_id, mode, customer_id, wallet_id, status, reference, metadata)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, 'creating', $6, $7::jsonb)`,
          id,
          ctx.scope.accountId,
          ctx.scope.mode,
          customer.id,
          wallet.id,
          ctx.body.reference ?? null,
          JSON.stringify(ctx.body.metadata ?? {}),
        );
      } catch (err) {
        const which = uniqueViolation(err);
        if (which === "dev_virtual_accounts_reference_uidx") {
          throw new V1Error(409, "Another virtual account already uses this reference.", "duplicate_reference", "reference");
        }
        if (which === "dev_virtual_accounts_customer_uidx") {
          throw new V1Error(409, "A virtual account is already being opened for this customer. Retry in a few seconds.", "virtual_account_in_progress", "customer_id");
        }
        throw err;
      }

      let opened: Opened;
      try {
        opened = ctx.mode === "test" ? sandboxAccount(customer) : await openLiveAccount(customer);
      } catch (err) {
        const reason = err instanceof Error ? err.message.slice(0, 200) : "unknown";
        await prisma.$executeRawUnsafe(
          `UPDATE dev_virtual_accounts SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1::uuid`,
          id,
          reason,
        );
        if (err instanceof ApiError) throw err;
        console.error("[devapi] virtual account not opened", { virtual_account: id, reason });
        throw new V1Error(503, "The account couldn't be opened right now. Nothing was charged; retry shortly.", "service_unavailable");
      }

      let eventId: string | null = null;
      const row = await prisma.$transaction(async (db) => {
        const rows = await db.$queryRawUnsafe<VirtualAccountRow[]>(
          `UPDATE dev_virtual_accounts SET status = 'active', account_number = $2, bank_name = $3, account_name = $4,
              provider_account_id = $5, updated_at = now()
            WHERE id = $1::uuid RETURNING *`,
          id,
          opened.accountNumber,
          opened.bankName,
          opened.accountName,
          opened.providerAccountId,
        );
        await complete(db, "virtual_account", id, 201);
        eventId = await recordEvent(db, {
          accountId: ctx.scope.accountId,
          mode: ctx.scope.mode,
          type: "virtual_account.created",
          object: virtualAccountObject(rows[0]),
        });
        return rows[0];
      });
      if (eventId) deliverSoon([eventId]);
      return { status: 201, body: virtualAccountObject(row) };
    },
  });
}

/** For deposits: the live virtual account a partner transaction landed in. */
export async function findLiveVirtualAccount(input: { providerAccountId: string | null; providerCustomerId: string | null }): Promise<VirtualAccountRow | null> {
  await ensureDevApiSchema();
  if (input.providerAccountId) {
    const rows = await prisma.$queryRawUnsafe<VirtualAccountRow[]>(
      `SELECT * FROM dev_virtual_accounts WHERE mode = 'live' AND provider_account_id = $1 AND status IN ('active', 'closed')`,
      input.providerAccountId,
    );
    if (rows[0]) return rows[0];
  }
  if (input.providerCustomerId) {
    const rows = await prisma.$queryRawUnsafe<VirtualAccountRow[]>(
      `SELECT v.* FROM dev_virtual_accounts v JOIN dev_customers c ON c.id = v.customer_id
        WHERE c.provider_customer_id = $1 AND v.mode = 'live' AND v.status = 'active'`,
      input.providerCustomerId,
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

