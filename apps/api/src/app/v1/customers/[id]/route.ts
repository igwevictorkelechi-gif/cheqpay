import { V1Error, withApi } from "@/lib/devapi/handler";
import { customerObject, customerUpdateSchema, getCustomer, refreshSandboxPending, updateCustomer } from "@/lib/devapi/customers";
import { resolveId } from "@/lib/devapi/inputs";

export const dynamic = "force-dynamic";

/** One customer and their verification status. */
export const GET = withApi({ scope: "customers:read" }, async (ctx, params) => {
  const id = resolveId("customer", params.id, "id", "customer");
  const customer = await getCustomer(ctx.scope, id);
  if (!customer) throw new V1Error(404, "No such customer.", "not_found", "id");
  return { body: customerObject(await refreshSandboxPending(customer)) };
});

/**
 * Update metadata at any time. Identity details can change only after a
 * rejection, and changing them starts verification again.
 */
export const PATCH = withApi(
  { scope: "customers:write", body: customerUpdateSchema, logFields: ["kyc_consent"] },
  async (ctx, params) => updateCustomer(ctx, resolveId("customer", params.id, "id", "customer")),
);
