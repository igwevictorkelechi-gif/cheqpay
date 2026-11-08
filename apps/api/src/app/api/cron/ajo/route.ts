import { schedulerRefusal } from "@/lib/cronAuth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getFeatureFlags } from "@/lib/features";
import { runAjo } from "@/lib/ajo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Ajo scheduler pass: settles arrears from new wallet money, runs due group
 * rounds and takes due personal-plan contributions (all due at 08:00 UTC).
 * Vercel Cron runs it daily just after 9am Lagos; the database scheduler can
 * call it more often (POST, with DB_CRON_SECRET) so arrears clear quickly.
 *
 * It keeps running while the feature flag is off once anything exists: a
 * switched-off flag stops new plans and groups, not money already committed.
 */
async function run(req: Request) {
  try {
    const refused = schedulerRefusal(req);
    if (refused) return refused;
    const flags = await getFeatureFlags();
    return jsonOk({ ran: true, enabled: flags.ajo, ...(await runAjo({ budgetMs: 240_000 })) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = run;
export const POST = run;
