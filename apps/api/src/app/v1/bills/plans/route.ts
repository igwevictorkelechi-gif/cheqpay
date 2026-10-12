import { withApi } from "@/lib/devapi/handler";
import { listBillPlans } from "@/lib/devapi/bills";

export const dynamic = "force-dynamic";

/** The plans a data or cable TV biller sells today: ?service=data&biller_id=mtn. */
export const GET = withApi({ scope: "bills:read" }, async (ctx) => ({ body: await listBillPlans(ctx.mode, ctx.query) }));
