import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { nextUpFor } from "@/lib/nextUp";

export const dynamic = "force-dynamic";

/**
 * Home's "Next up": up to three scheduled money movements in the next month —
 * Ajo auto-saves, Ajo circle rounds (paying in, or your turn to collect) and
 * bill autopays — soonest first. Read-only; an empty list means nothing is
 * scheduled, and the card is not shown.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return jsonOk({ items: await nextUpFor(user.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
