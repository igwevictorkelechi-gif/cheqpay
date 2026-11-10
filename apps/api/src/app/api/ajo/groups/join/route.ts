import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";
import { ajoJoinSchema } from "@/lib/validation";
import { joinGroup } from "@/lib/ajo";
import { groupView } from "@/lib/ajo/view";

export const dynamic = "force-dynamic";

/**
 * Join a group with its invite code. The PIN and the ticked terms are the
 * member's authority for the auto-debits and for the arrears lien.
 * Rate-limited tightly: invite codes are short, so guessing must be slow.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("ajo");
    await enforceRateLimit(`ajo:join:${auth.id}`, 10, 10 * 60_000);
    const body = ajoJoinSchema.parse(await req.json());
    await requireTransactionPin(auth.id, readPin(req));
    const g = await joinGroup(auth.id, body.code);
    return jsonOk({ group: groupView({ ...g, position: null }, auth.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
