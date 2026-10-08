import { withApi } from "@/lib/devapi/handler";
import { createVirtualAccount, listVirtualAccounts, virtualAccountCreateSchema, virtualAccountObject } from "@/lib/devapi/virtualAccounts";

export const dynamic = "force-dynamic";

/** Your customers' virtual accounts in this mode, newest first. */
export const GET = withApi({ scope: "virtual_accounts:read" }, async (ctx) => {
  const page = await listVirtualAccounts(ctx.scope, ctx.query);
  return { body: { ...page, data: page.data.map(virtualAccountObject) } };
});

/**
 * Open a dedicated NGN bank account for a verified customer. One per customer:
 * asking again returns the existing account (200).
 */
export const POST = withApi(
  { scope: "virtual_accounts:write", body: virtualAccountCreateSchema, logFields: ["customer_id", "reference"] },
  (ctx) => createVirtualAccount(ctx),
);
