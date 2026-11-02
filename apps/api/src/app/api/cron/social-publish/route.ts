import { bearerMatches, cronRefusal } from "@/lib/cronAuth";
import { getEnv } from "@/lib/env";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { runPublisher } from "@/lib/social/publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sends due social posts. Called every minute by the database scheduler
 * (pg_cron + pg_net) with SOCIAL_CRON_SECRET — Vercel Hobby crons run only
 * daily — or by Vercel Cron / a person with CRON_SECRET.
 */
async function handle(req: Request) {
  const social = getEnv().SOCIAL_CRON_SECRET;
  const viaSocialSecret = Boolean(social && bearerMatches(req.headers.get("authorization"), social));
  if (!viaSocialSecret) {
    const refusal = cronRefusal(req);
    if (refusal) return refusal;
  }
  try {
    return jsonOk(await runPublisher({ budgetMs: 240_000 }));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = handle;
export const POST = handle;
