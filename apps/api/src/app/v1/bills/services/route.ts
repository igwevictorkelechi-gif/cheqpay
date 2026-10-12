import { withApi } from "@/lib/devapi/handler";
import { listBillServices } from "@/lib/devapi/bills";

export const dynamic = "force-dynamic";

/** Bill services (airtime, data, electricity, cable TV) and their billers. */
export const GET = withApi({ scope: "bills:read" }, async (ctx) => ({ body: listBillServices(ctx.mode) }));
