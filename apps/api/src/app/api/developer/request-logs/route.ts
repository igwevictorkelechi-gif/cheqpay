import { jsonOk, toErrorResponse } from "@/lib/http";
import { requireDeveloper } from "@/lib/devapi/dashboard";
import { listRequestLogs } from "@/lib/devapi/logs";

export const dynamic = "force-dynamic";

/** The last requests made with your keys, including why any key was refused. */
export async function GET(req: Request) {
  try {
    const s = await requireDeveloper(req);
    const q = new URL(req.url).searchParams;
    const logs = await listRequestLogs(s.account.id, q.get("mode") === "live" ? "live" : "test", {
      errorsOnly: q.get("errors") === "1",
      limit: Number(q.get("limit") ?? 100) || 100,
    });
    return jsonOk({ logs });
  } catch (err) {
    return toErrorResponse(err);
  }
}
