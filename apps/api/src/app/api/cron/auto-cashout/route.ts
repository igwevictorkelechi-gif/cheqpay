import { cronRefusal } from "@/lib/cronAuth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { runAutoCashouts } from "@/lib/autoCashout";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Retries auto cash-outs that are waiting (the exchange or the bank was
 * unreachable). New deposits are cashed out the moment they land; this only
 * sweeps what is left over. POST too, so a database scheduler can call it.
 */
async function run(req: Request) {
  try {
    const refused = cronRefusal(req);
    if (refused) return refused;
    return jsonOk({ ran: true, ...(await runAutoCashouts({ budgetMs: 240_000 })) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = run;
export const POST = run;
