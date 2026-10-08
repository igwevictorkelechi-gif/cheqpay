import { withApi } from "@/lib/devapi/handler";
import { conversionSchema, createConversion } from "@/lib/devapi/fx";

export const dynamic = "force-dynamic";

/**
 * Spend a quote: debit the source wallet, credit the target wallet of the same
 * owner. Answers 201 when settled, or 202 while a live exchange is confirming.
 */
export const POST = withApi(
  { scope: "fx:write", body: conversionSchema, moneyMoving: true, logFields: ["quote_id", "from_wallet_id", "to_wallet_id", "reference"] },
  (ctx) => createConversion(ctx, ctx.ip),
);
