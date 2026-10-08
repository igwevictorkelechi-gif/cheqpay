import { prisma } from "@cheqpay/db";
import { fromPublicId } from "@cheqpay/devapi";
import { V1Error, withApi } from "@/lib/devapi/handler";
import { getWallet, listEntries } from "@/lib/devapi/ledger";
import { listParams } from "@/lib/devapi/lists";
import { entryObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

/** A wallet's statement: every balance change, newest first, with the balance after it. */
export const GET = withApi({ scope: "wallets:read" }, async (ctx, params) => {
  const id = fromPublicId("wallet", params.id);
  const wallet = id ? await getWallet(prisma, ctx.scope, id) : null;
  if (!wallet) throw new V1Error(404, "No such wallet.", "not_found", "id");
  const { limit, startingAfter } = listParams(ctx.query);
  if (startingAfter !== null && !/^\d{1,19}$/.test(startingAfter)) {
    throw new V1Error(400, "starting_after must be an entry id from this statement.", "validation_error", "starting_after");
  }
  const rows = await listEntries(wallet.id, { limit: limit + 1, before: startingAfter ? BigInt(startingAfter) : null });
  return { body: { object: "list", data: rows.slice(0, limit).map(entryObject), has_more: rows.length > limit } };
});
