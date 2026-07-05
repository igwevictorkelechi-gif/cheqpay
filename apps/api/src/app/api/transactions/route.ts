import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { serializeTransaction } from "@/lib/txn";

export const dynamic = "force-dynamic";

/**
 * Return the caller's ledger transactions (most recent first). Each row carries
 * formatted amounts and, for swaps/converts, the from/to legs from metadata so
 * the client can render them without re-deriving units.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100);

    const rows = await prisma.transaction.findMany({
      where: { userId: auth.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const transactions = rows.map(serializeTransaction);

    return jsonOk({ transactions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
