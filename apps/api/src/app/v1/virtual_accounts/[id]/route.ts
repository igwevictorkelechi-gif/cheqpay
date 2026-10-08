import { V1Error, withApi } from "@/lib/devapi/handler";
import { getVirtualAccount, virtualAccountObject } from "@/lib/devapi/virtualAccounts";
import { resolveId } from "@/lib/devapi/inputs";

export const dynamic = "force-dynamic";

/** One virtual account. */
export const GET = withApi({ scope: "virtual_accounts:read" }, async (ctx, params) => {
  const id = resolveId("virtual_account", params.id, "id", "virtual account");
  const va = await getVirtualAccount(ctx.scope, id);
  if (!va || va.status === "creating" || va.status === "failed") throw new V1Error(404, "No such virtual account.", "not_found", "id");
  return { body: virtualAccountObject(va) };
});
