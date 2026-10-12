import { withApi } from "@/lib/devapi/handler";
import { listCardTransactions } from "@/lib/devapi/cards";

export const dynamic = "force-dynamic";

/** What the card was used for, newest first, as the issuer records it. */
export const GET = withApi({ scope: "cards:read" }, (ctx, params) => listCardTransactions(ctx, params.id));
