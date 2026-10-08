// apps/api/src/lib/devapi/transfers.ts
//
// Moving money between a developer's own wallets: main <-> customer, or one
// customer's wallet to another's. Internal only — money never leaves CheqPay
// this way, so it carries no fee and doesn't count against the daily outflow
// limit. Both legs, the transaction row, the idempotency record and the
// transfer.completed event commit in one database transaction.

import { prisma } from "@cheqpay/db";
import { z } from "zod";
import { effectiveLimits, getDevLimits } from "./limits";
import { V1Error, type ApiContext, type HandlerResult } from "./handler";
import { applyLegs, getTransaction, getWallet, insertTransaction } from "./ledger";
import { recordEvent } from "./events";
import { deliverSoon } from "./webhooks";
import { amountSchema, descriptionSchema, metadataSchema, referenceSchema, resolveId, uniqueViolation } from "./inputs";
import { runIdempotent } from "./idempotency";
import { transactionObject } from "./serialize";

const MONEY_TX = { maxWait: 10_000, timeout: 15_000 };

export const transferSchema = z
  .object({
    from_wallet_id: z.string().max(80),
    to_wallet_id: z.string().max(80),
    amount: amountSchema,
    reference: referenceSchema.optional(),
    description: descriptionSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export async function createTransfer(ctx: ApiContext<z.infer<typeof transferSchema>>, initiatorIp: string | null): Promise<HandlerResult> {
  const b = ctx.body;
  const fromId = resolveId("wallet", b.from_wallet_id, "from_wallet_id", "wallet");
  const toId = resolveId("wallet", b.to_wallet_id, "to_wallet_id", "wallet");
  if (fromId === toId) throw new V1Error(400, "from_wallet_id and to_wallet_id must be different wallets.", "validation_error", "to_wallet_id");
  const amount = BigInt(b.amount);

  return runIdempotent(ctx, b, {
    replay: async (id) => ({ body: transactionObject((await getTransaction(prisma, ctx.scope, id))!) }),
    work: async (complete) => {
      const [from, to] = await Promise.all([getWallet(prisma, ctx.scope, fromId), getWallet(prisma, ctx.scope, toId)]);
      if (!from) throw new V1Error(404, "No such wallet.", "not_found", "from_wallet_id");
      if (!to) throw new V1Error(404, "No such wallet.", "not_found", "to_wallet_id");
      if (from.currency !== to.currency) {
        throw new V1Error(400, `The wallets hold different currencies (${from.currency} and ${to.currency}). Use a conversion instead.`, "currency_mismatch", "to_wallet_id");
      }
      if (ctx.mode === "live") {
        const limits = effectiveLimits(ctx.account, await getDevLimits());
        if (amount > limits.perTxnMax[from.currency]) {
          throw new V1Error(422, "That is over the largest single movement allowed on your account.", "limit_exceeded", "amount");
        }
      }

      let eventId: string | null = null;
      let txId: string;
      try {
        txId = await prisma.$transaction(async (db) => {
          const id = await insertTransaction(db, {
            accountId: ctx.scope.accountId,
            mode: ctx.scope.mode,
            kind: "transfer",
            status: "successful",
            currency: from.currency,
            amountMinor: amount,
            walletId: from.id,
            counterpartyWalletId: to.id,
            customerId: to.customer_id ?? from.customer_id,
            reference: b.reference ?? null,
            description: b.description ?? null,
            metadata: b.metadata ?? {},
            initiatorIp,
          });
          await applyLegs(db, ctx.scope, id, from.currency, [
            { walletId: from.id, amountMinor: -amount, kind: "transfer_out" },
            { walletId: to.id, amountMinor: amount, kind: "transfer_in" },
          ]);
          await complete(db, "transaction", id, 201);
          const tx = (await getTransaction(db, ctx.scope, id))!;
          eventId = await recordEvent(db, { accountId: ctx.scope.accountId, mode: ctx.scope.mode, type: "transfer.completed", object: transactionObject(tx) });
          return id;
        }, MONEY_TX);
      } catch (err) {
        if (uniqueViolation(err)?.includes("reference")) {
          throw new V1Error(409, "Another transaction already uses this reference.", "duplicate_reference", "reference");
        }
        throw err;
      }
      if (eventId) deliverSoon([eventId]);
      return { status: 201, body: transactionObject((await getTransaction(prisma, ctx.scope, txId))!) };
    },
  });
}
