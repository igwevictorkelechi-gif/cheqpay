import { withApi } from "@/lib/devapi/handler";
import { createCustomer, customerCreateSchema, customerObject, listCustomers } from "@/lib/devapi/customers";

export const dynamic = "force-dynamic";

/** Your customers in this mode, newest first. Filter by kyc_status, email or reference. */
export const GET = withApi({ scope: "customers:read" }, async (ctx) => {
  const page = await listCustomers(ctx.scope, ctx.query);
  return { body: { ...page, data: page.data.map(customerObject) } };
});

/**
 * Create a customer and start their identity verification. Test mode decides
 * at once; live mode answers `pending` and sends customer.verified or
 * customer.rejected. BVN, ID number, date of birth and address are write-only.
 */
export const POST = withApi(
  { scope: "customers:write", body: customerCreateSchema, logFields: ["reference", "kyc_consent"] },
  (ctx) => createCustomer(ctx),
);
