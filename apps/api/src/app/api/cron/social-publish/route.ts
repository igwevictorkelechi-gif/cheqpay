import { schedulerRefusal } from "@/lib/cronAuth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { runPublisher } from "@/lib/social/publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sends due social posts. Called every minute by the database scheduler
 * (pg_cron + pg_net) with DB_CRON_SECRET — Vercel Hobby crons run only
 * daily — or by Vercel Cron / a person with CRON_SECRET.
 */
async function handle(req: Request) {
  const refusal = schedulerRefusal(req);
  if (refusal) return refusal;
  try {
    return jsonOk(await runPublisher({ budgetMs: 240_000 }));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = handle;
export const POST = handle;
