import { withApi } from "@/lib/devapi/handler";
import { revealCard } from "@/lib/devapi/cards";

export const dynamic = "force-dynamic";

/**
 * The card's full number, CVV and expiry. Needs the cards:details scope (and,
 * for live keys, an IP allowlist). At most 10 times per card per hour; every
 * reveal is recorded in your security log. Never cached, never logged.
 */
export const GET = withApi({ scope: "cards:details" }, (ctx, params) => revealCard(ctx, params.id));
