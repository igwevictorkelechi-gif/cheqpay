import { withApi } from "@/lib/devapi/handler";
import { listWallets } from "@/lib/devapi/lists";
import { walletObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

/** The account's wallets in this mode: the main NGN and USD wallets, and customer wallets. */
export const GET = withApi({ scope: "wallets:read" }, async (ctx) => {
  const page = await listWallets(ctx.scope, ctx.query);
  return { body: { ...page, data: page.data.map(walletObject) } };
});
