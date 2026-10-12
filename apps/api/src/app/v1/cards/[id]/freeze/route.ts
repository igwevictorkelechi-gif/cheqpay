import { withApi } from "@/lib/devapi/handler";
import { setCardFrozen } from "@/lib/devapi/cards";

export const dynamic = "force-dynamic";

/** Freeze a card: it can't be used or funded until it's unfrozen. */
export const POST = withApi({ scope: "cards:write" }, (ctx, params) => setCardFrozen(ctx, params.id, true));
