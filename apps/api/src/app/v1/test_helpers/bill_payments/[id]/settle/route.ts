import { withApi } from "@/lib/devapi/handler";
import { settleTestBill, testSettleSchema } from "@/lib/devapi/bills";
import { resolveId } from "@/lib/devapi/inputs";
import { transactionObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

/**
 * Test mode only: settle a pending sandbox bill payment (a customer number
 * ending in 1111) as successful or failed, which refunds it and sends the
 * matching event. A payment that already settled is returned unchanged.
 * Live keys get 404.
 */
export const POST = withApi(
  { scope: "bills:write", body: testSettleSchema, testOnly: true, logFields: ["outcome"] },
  async (ctx, params) => {
    const id = resolveId("transaction", params.id, "id", "bill payment");
    return { body: transactionObject(await settleTestBill(ctx.scope, id, ctx.body.outcome)) };
  },
);
