import { schedulerRefusal } from "@/lib/cronAuth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { runAutoCashouts } from "@/lib/autoCashout";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Retries auto cash-outs that are waiting (the exchange or the bank was
 * unreachable). New deposits are cashed out the moment they land; this only
 * sweeps what is left over. The database scheduler calls it every minute
 * (POST, with DB_CRON_SECRET); Vercel Cron's daily run is the backstop.
 */
async function run(req: Request) {
  try {
    const refused = schedulerRefusal(req);
    if (refused) return refused;
    return jsonOk({ ran: true, ...(await runAutoCashouts({ budgetMs: 240_000 })) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = run;
export const POST = run;
