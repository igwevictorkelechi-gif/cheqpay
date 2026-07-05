import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { serializeTransaction } from "@/lib/txn";

export const dynamic = "force-dynamic";

/** A single ledger transaction owned by the caller (for the details/receipt view). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUser(req);
    const { id } = await params;

    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.userId !== auth.id) {
      throw new ApiError(404, "Transaction not found", "not_found");
    }
    return jsonOk({ transaction: serializeTransaction(tx) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
