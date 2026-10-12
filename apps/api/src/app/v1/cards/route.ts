import { withApi } from "@/lib/devapi/handler";
import { cardCreateSchema, createDevCard, listDevCards } from "@/lib/devapi/cards";

export const dynamic = "force-dynamic";

/** Cards in this mode, newest first. Filter by customer_id. */
export const GET = withApi({ scope: "cards:read" }, async (ctx) => ({ body: await listDevCards(ctx.scope, ctx.query) }));

/**
 * Issue a USD virtual card to a verified customer, with its first top-up, paid
 * from a USD wallet. 201 when issued (sandbox), 202 while the issuer creates it.
 */
export const POST = withApi(
  { scope: "cards:write", body: cardCreateSchema, moneyMoving: true, logFields: ["customer_id", "amount", "wallet_id", "brand", "reference"] },
  (ctx) => createDevCard(ctx, ctx.ip),
);
