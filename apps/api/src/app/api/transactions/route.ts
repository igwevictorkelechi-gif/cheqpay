import { Asset, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";

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

    const transactions = rows.map((t) => {
      const meta = (t.metadata ?? {}) as {
        fromAsset?: string;
        toAsset?: string;
        amountIn?: string;
        amountOut?: string;
        kind?: string;
      };
      const fromAsset = meta.fromAsset as Asset | undefined;
      const toAsset = meta.toAsset as Asset | undefined;
      return {
        id: t.id,
        type: t.type, // DEPOSIT | WITHDRAWAL | BUY | SELL | CONVERT
        asset: t.asset,
        network: t.network,
        amount: t.amount.toString(),
        amountFormatted: fromMinorUnits(t.amount, t.asset),
        fee: t.fee.toString(),
        status: t.status, // PENDING | PROCESSING | COMPLETED | FAILED | REVERSED
        txHash: t.txHash,
        createdAt: t.createdAt.toISOString(),
        // Swap/convert legs (present for BUY/SELL/CONVERT).
        fromAsset: fromAsset ?? null,
        toAsset: toAsset ?? null,
        fromFormatted:
          fromAsset && meta.amountIn ? fromMinorUnits(BigInt(meta.amountIn), fromAsset) : null,
        toFormatted:
          toAsset && meta.amountOut ? fromMinorUnits(BigInt(meta.amountOut), toAsset) : null,
      };
    });

    return jsonOk({ transactions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
