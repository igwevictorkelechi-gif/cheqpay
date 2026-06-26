import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Return the user's ledger balances per asset (minor units + formatted). */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const balances = await prisma.balance.findMany({
      where: { userId: auth.id },
      orderBy: { asset: "asc" },
    });
    return jsonOk({
      balances: balances.map((b) => ({
        asset: b.asset,
        available: b.available.toString(),
        locked: b.locked.toString(),
        availableFormatted: fromMinorUnits(b.available, b.asset),
        lockedFormatted: fromMinorUnits(b.locked, b.asset),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
