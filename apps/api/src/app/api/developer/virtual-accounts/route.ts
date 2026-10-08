import { jsonOk, toErrorResponse } from "@/lib/http";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { listVirtualAccounts, virtualAccountObject } from "@/lib/devapi/virtualAccounts";

export const dynamic = "force-dynamic";

/** The same list as GET /v1/virtual_accounts, for the signed-in owner. */
export async function GET(req: Request) {
  try {
    const s = await requireDeveloper(req);
    const q = new URL(req.url).searchParams;
    const mode = q.get("mode") === "live" ? "live" : "test";
    const page = await listVirtualAccounts({ accountId: s.account.id, mode }, q);
    return jsonOk({ ...page, data: page.data.map(virtualAccountObject) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
