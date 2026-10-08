import { prisma } from "@cheqpay/db";
import { z } from "zod";
import { withApi } from "@/lib/devapi/handler";
import { simulateDeposit } from "@/lib/devapi/deposits";
import { amountSchema, resolveId } from "@/lib/devapi/inputs";
import { getTransaction } from "@/lib/devapi/ledger";
import { runIdempotent } from "@/lib/devapi/idempotency";
import { transactionObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    amount: amountSchema,
    sender_name: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{M} .'’-]+$/u, "Letters only").optional(),
  })
  .strict();

/**
 * Test mode only: simulate a bank transfer into a virtual account. It is
 * credited exactly like a real one (less the deposit fee) and sends
 * deposit.received. Live keys get 404.
 */
export const POST = withApi(
  { scope: "virtual_accounts:write", body: schema, testOnly: true, logFields: ["amount"] },
  async (ctx, params) => {
    const id = resolveId("virtual_account", params.id, "id", "virtual account");
    return runIdempotent(ctx, { id, ...ctx.body }, {
      replay: async (txId) => ({ status: 201, body: transactionObject((await getTransaction(prisma, ctx.scope, txId))!) }),
      work: async (complete) => {
        const tx = await simulateDeposit(ctx.scope, id, BigInt(ctx.body.amount), { name: ctx.body.sender_name }, (db, txId) =>
          complete(db, "transaction", txId, 201),
        );
        return { status: 201, body: transactionObject(tx) };
      },
    });
  },
);
