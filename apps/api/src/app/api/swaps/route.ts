import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { executeSwap } from "@/lib/swap";
import { swapExecuteSchema } from "@/lib/validation";
import { readPin, requireTransactionPin } from "@/lib/transactionPin";

import { assertFeatureEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";

/** Execute a previously issued quote (idempotent). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("crypto_trading");
    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }
    const { quoteId } = swapExecuteSchema.parse(await req.json());

    // Authorise the conversion. Unlike the payout routes the replay check
    // lives inside executeSwap, so the PIN is verified first here. That is
    // acceptable: a conversion moves between the user's OWN balances, so the
    // worst a re-authorised replay costs is one extra PIN entry, and a client
    // retrying resends its headers anyway.
    await requireTransactionPin(auth.id, readPin(req));

    const result = await executeSwap({ userId: auth.id, quoteId, idempotencyKey });
    return jsonOk(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
