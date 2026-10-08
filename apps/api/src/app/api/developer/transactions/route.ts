import { jsonOk, toErrorResponse } from "@/lib/http";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { listTransactions } from "@/lib/devapi/lists";
import { transactionObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = await requireDeveloper(req);
    const q = new URL(req.url).searchParams;
    const mode = q.get("mode") === "live" ? "live" : "test";
    const page = await listTransactions({ accountId: s.account.id, mode }, q);
    return jsonOk({ ...page, data: page.data.map(transactionObject) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
