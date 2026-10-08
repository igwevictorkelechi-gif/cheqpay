import { prisma } from "@cheqpay/db";
import { fromPublicId } from "@cheqpay/devapi";
import { V1Error, withApi } from "@/lib/devapi/handler";
import { getWallet } from "@/lib/devapi/ledger";
import { walletObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "wallets:read" }, async (ctx, params) => {
  const id = fromPublicId("wallet", params.id);
  const wallet = id ? await getWallet(prisma, ctx.scope, id) : null;
  if (!wallet) throw new V1Error(404, "No such wallet.", "not_found", "id");
  return { body: walletObject(wallet) };
});
