import { withApi } from "@/lib/devapi/handler";
import { setCardFrozen } from "@/lib/devapi/cards";

export const dynamic = "force-dynamic";

/** Unfreeze a frozen card. */
export const POST = withApi({ scope: "cards:write" }, (ctx, params) => setCardFrozen(ctx, params.id, false));
