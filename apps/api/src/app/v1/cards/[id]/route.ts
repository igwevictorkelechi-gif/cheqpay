import { withApi } from "@/lib/devapi/handler";
import { retrieveCard } from "@/lib/devapi/cards";

export const dynamic = "force-dynamic";

/** One card. In live mode its balance is read from the issuer. Never the full number. */
export const GET = withApi({ scope: "cards:read" }, (ctx, params) => retrieveCard(ctx, params.id));
