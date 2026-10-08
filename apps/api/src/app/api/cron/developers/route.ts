import { cronRefusal } from "@/lib/cronAuth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { runDevelopersDaily } from "@/lib/devapi/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily, 06:35 Lagos: renew developer plans, reconcile developer wallets, prune logs. */
export async function GET(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;
    const out = await runDevelopersDaily();
    return jsonOk(JSON.parse(JSON.stringify({ ran: true, ...out }, (_k, v) => (typeof v === "bigint" ? Number(v) : v))));
  } catch (err) {
    return toErrorResponse(err);
  }
}
