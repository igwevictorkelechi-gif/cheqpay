// apps/api/src/lib/devapi/lists.ts
//
// Paged lists. Every query takes the request's scope (account + mode, from the
// key) as its first condition — there is no way to call these for "any
// account". Cursors are public ids; a cursor from another account or mode
// simply finds nothing and returns the first page's worth of nothing.

import { prisma } from "@cheqpay/db";
import { fromPublicId } from "@cheqpay/devapi";
import { V1Error } from "./handler";
import type { DevTransactionRow, Mode, WalletRow } from "./types";

export interface Scope {
  accountId: string;
  mode: Mode;
}

export interface Page<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

export function listParams(q: URLSearchParams): { limit: number; startingAfter: string | null } {
  const rawLimit = q.get("limit");
  let limit = 20;
  if (rawLimit !== null) {
    if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
      throw new V1Error(400, "limit must be between 1 and 100.", "validation_error", "limit");
    }
    limit = Number(rawLimit);
  }
  return { limit, startingAfter: q.get("starting_after") };
}

function oneOf<T extends string>(q: URLSearchParams, name: string, allowed: readonly T[]): T | null {
  const v = q.get(name);
  if (v === null) return null;
  if (!(allowed as readonly string[]).includes(v)) {
    throw new V1Error(400, `${name} must be one of: ${allowed.join(", ")}.`, "validation_error", name);
  }
  return v as T;
}

function idParam(q: URLSearchParams, name: string, kind: Parameters<typeof fromPublicId>[0]): string | null | "none" {
  const v = q.get(name);
  if (v === null) return null;
  return fromPublicId(kind, v) ?? "none";
}

export async function listWallets(scope: Scope, q: URLSearchParams): Promise<Page<WalletRow>> {
  const { limit, startingAfter } = listParams(q);
  const currency = oneOf(q, "currency", ["NGN", "USD"] as const);
  const type = oneOf(q, "type", ["main", "customer"] as const);
  const customer = idParam(q, "customer_id", "customer");
  if (customer === "none") return { object: "list", data: [], has_more: false };
  const after = startingAfter ? fromPublicId("wallet", startingAfter) : null;
  if (startingAfter && !after) throw new V1Error(400, "starting_after must be a wallet id.", "validation_error", "starting_after");

  const rows = await prisma.$queryRawUnsafe<WalletRow[]>(
    `SELECT * FROM dev_wallets w
      WHERE w.account_id = $1::uuid AND w.mode = $2
        AND ($3::text IS NULL OR w.currency = $3)
        AND ($4::text IS NULL OR ($4 = 'main' AND w.customer_id IS NULL) OR ($4 = 'customer' AND w.customer_id IS NOT NULL))
        AND ($5::uuid IS NULL OR w.customer_id = $5::uuid)
        AND ($6::uuid IS NULL OR (w.created_at, w.id) < (SELECT c.created_at, c.id FROM dev_wallets c
              WHERE c.id = $6::uuid AND c.account_id = $1::uuid AND c.mode = $2))
      ORDER BY w.created_at DESC, w.id DESC
      LIMIT $7`,
    scope.accountId,
    scope.mode,
    currency,
    type,
    customer,
    after,
    limit + 1,
  );
  return { object: "list", data: rows.slice(0, limit), has_more: rows.length > limit };
}

export const TRANSACTION_KINDS = [
  "top_up",
  "wallet_move",
  "subscription",
  "deposit",
  "transfer",
  "conversion",
  "bill_payment",
  "card_issue",
  "card_funding",
  "card_withdrawal",
  "fee",
  "adjustment",
] as const;
export const TRANSACTION_STATUSES = ["pending", "successful", "failed", "reversed"] as const;

export async function listTransactions(scope: Scope, q: URLSearchParams, fixed: { kind?: string } = {}): Promise<Page<DevTransactionRow>> {
  const { limit, startingAfter } = listParams(q);
  const kind = fixed.kind ?? oneOf(q, "kind", TRANSACTION_KINDS);
  const status = oneOf(q, "status", TRANSACTION_STATUSES);
  const wallet = idParam(q, "wallet_id", "wallet");
  const customer = idParam(q, "customer_id", "customer");
  if (wallet === "none" || customer === "none") return { object: "list", data: [], has_more: false };
  const reference = q.get("reference");
  if (reference !== null && (reference.length < 1 || reference.length > 100)) {
    throw new V1Error(400, "reference must be 1 to 100 characters.", "validation_error", "reference");
  }
  const after = startingAfter ? fromPublicId("transaction", startingAfter) : null;
  if (startingAfter && !after) throw new V1Error(400, "starting_after must be a transaction id.", "validation_error", "starting_after");

  const rows = await prisma.$queryRawUnsafe<DevTransactionRow[]>(
    `SELECT * FROM dev_transactions t
      WHERE t.account_id = $1::uuid AND t.mode = $2
        AND ($3::text IS NULL OR t.kind = $3)
        AND ($4::text IS NULL OR t.status = $4)
        AND ($5::uuid IS NULL OR t.wallet_id = $5::uuid OR t.counterparty_wallet_id = $5::uuid)
        AND ($6::uuid IS NULL OR t.customer_id = $6::uuid)
        AND ($7::text IS NULL OR t.reference = $7)
        AND ($8::uuid IS NULL OR (t.created_at, t.id) < (SELECT c.created_at, c.id FROM dev_transactions c
              WHERE c.id = $8::uuid AND c.account_id = $1::uuid AND c.mode = $2))
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $9`,
    scope.accountId,
    scope.mode,
    kind,
    status,
    wallet,
    customer,
    reference,
    after,
    limit + 1,
  );
  return { object: "list", data: rows.slice(0, limit), has_more: rows.length > limit };
}
