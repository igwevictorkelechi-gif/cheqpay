import { withApi } from "@/lib/devapi/handler";
import { createQuote, quoteSchema } from "@/lib/devapi/fx";

export const dynamic = "force-dynamic";

/** Price an NGN<->USD conversion. The quote is good for 45 seconds and converts once. */
export const POST = withApi(
  { scope: "fx:write", body: quoteSchema, logFields: ["from_currency", "to_currency", "amount"] },
  (ctx) => createQuote(ctx),
);
