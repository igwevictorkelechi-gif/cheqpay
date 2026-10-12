import { withApi } from "@/lib/devapi/handler";
import { cardMoveSchema, withdrawDevCard } from "@/lib/devapi/cards";

export const dynamic = "force-dynamic";

/** Take money off a card back into a USD wallet of the same owner. */
export const POST = withApi(
  { scope: "cards:write", body: cardMoveSchema, moneyMoving: true, logFields: ["amount", "wallet_id", "reference"] },
  (ctx, params) => withdrawDevCard(ctx, params.id, ctx.ip),
);
