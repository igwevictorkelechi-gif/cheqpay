import { prisma } from "@cheqpay/db";
import { fromPublicId } from "@cheqpay/devapi";
import { V1Error, withApi } from "@/lib/devapi/handler";
import { getTransaction } from "@/lib/devapi/ledger";
import { transactionObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "bills:read" }, async (ctx, params) => {
  const id = fromPublicId("transaction", params.id);
  const tx = id ? await getTransaction(prisma, ctx.scope, id) : null;
  if (!tx || tx.kind !== "bill_payment") throw new V1Error(404, "No such bill payment.", "not_found", "id");
  return { body: transactionObject(tx) };
});
