import { withApi } from "@/lib/devapi/handler";
import { listTransactions } from "@/lib/devapi/lists";
import { transactionObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

/** Every money movement in this mode, newest first. Filter by kind, status, wallet, customer or reference. */
export const GET = withApi({ scope: "transactions:read" }, async (ctx) => {
  const page = await listTransactions(ctx.scope, ctx.query);
  return { body: { ...page, data: page.data.map(transactionObject) } };
});
