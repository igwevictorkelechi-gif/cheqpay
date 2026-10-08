import { withApi } from "@/lib/devapi/handler";
import { createTransfer, transferSchema } from "@/lib/devapi/transfers";

export const dynamic = "force-dynamic";

/**
 * Move money between two of your wallets in the same currency: main to a
 * customer, a customer to main, or customer to customer. Internal and free.
 */
export const POST = withApi(
  { scope: "transfers:write", body: transferSchema, moneyMoving: true, logFields: ["from_wallet_id", "to_wallet_id", "amount", "reference"] },
  (ctx) => createTransfer(ctx, ctx.ip),
);
