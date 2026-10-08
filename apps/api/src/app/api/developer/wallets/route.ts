import { jsonOk, toErrorResponse } from "@/lib/http";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { listWallets } from "@/lib/devapi/lists";
import { walletObject } from "@/lib/devapi/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = await requireDeveloper(req);
    const q = new URL(req.url).searchParams;
    const mode = q.get("mode") === "live" ? "live" : "test";
    const page = await listWallets({ accountId: s.account.id, mode }, q);
    return jsonOk({ ...page, data: page.data.map(walletObject) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
