import { withApi } from "@/lib/devapi/handler";
import { cardMoveSchema, fundDevCard } from "@/lib/devapi/cards";

export const dynamic = "force-dynamic";

/** Load money onto a card from a USD wallet of the same owner, plus your plan's top-up fee. */
export const POST = withApi(
  { scope: "cards:write", body: cardMoveSchema, moneyMoving: true, logFields: ["amount", "wallet_id", "reference"] },
  (ctx, params) => fundDevCard(ctx, params.id, ctx.ip),
);
