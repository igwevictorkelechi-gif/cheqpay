import { prisma } from "@cheqpay/db";
import { fromPublicId } from "@cheqpay/devapi";
import { V1Error, withApi } from "@/lib/devapi/handler";
import { getTransaction } from "@/lib/devapi/ledger";
import { transactionObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "transactions:read" }, async (ctx, params) => {
  const id = fromPublicId("transaction", params.id);
  const tx = id ? await getTransaction(prisma, ctx.scope, id) : null;
  if (!tx) throw new V1Error(404, "No such transaction.", "not_found", "id");
  return { body: transactionObject(tx) };
});
