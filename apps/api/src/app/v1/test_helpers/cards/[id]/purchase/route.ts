import { withApi } from "@/lib/devapi/handler";
import { simulatePurchase, testPurchaseSchema } from "@/lib/devapi/cards";

export const dynamic = "force-dynamic";

/**
 * Test mode only: spend on a sandbox card. Approved when the card is active
 * and holds enough, otherwise recorded as declined. Live keys get 404.
 */
export const POST = withApi(
  { scope: "cards:write", body: testPurchaseSchema, testOnly: true, logFields: ["amount"] },
  async (ctx, params) => ({ status: 201, body: await simulatePurchase(ctx.scope, params.id, BigInt(ctx.body.amount), ctx.body.merchant_name) }),
);
