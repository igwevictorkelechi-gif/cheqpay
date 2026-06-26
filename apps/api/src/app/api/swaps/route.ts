import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { executeSwap } from "@/lib/swap";
import { swapExecuteSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Execute a previously issued quote (idempotent). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError(400, "Missing Idempotency-Key header", "no_idempotency_key");
    }
    const { quoteId } = swapExecuteSchema.parse(await req.json());
    const result = await executeSwap({ userId: auth.id, quoteId, idempotencyKey });
    return jsonOk(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
