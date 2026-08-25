import { Asset, Prisma, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { serializeTransaction } from "@/lib/txn";

export const dynamic = "force-dynamic";

/**
 * A transaction "belongs to" an asset if it is denominated in it OR if it is a
 * swap/convert with that asset on either leg.
 *
 * The second part matters for the currency tabs: a NGN→USD convert is stored as
 * asset=NGN (the leg debited) with toAsset=USD in metadata. Matching only on
 * `asset` would hide it from the dollar view even though it is the reason the
 * dollar balance changed.
 */
function assetFilter(asset: Asset): Prisma.TransactionWhereInput {
  return {
    OR: [
      { asset },
      { metadata: { path: ["fromAsset"], equals: asset } },
      { metadata: { path: ["toAsset"], equals: asset } },
    ],
  };
}

function parseAsset(raw: string | null): Asset | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return (Object.values(Asset) as string[]).includes(upper) ? (upper as Asset) : null;
}

/**
 * Return the caller's ledger transactions (most recent first). Each row carries
 * formatted amounts and, for swaps/converts, the from/to legs from metadata so
 * the client can render them without re-deriving units.
 *
 * `?asset=NGN|USD|BTC|…` narrows the list to one currency, which is what the
 * home screen's currency tabs use. An unknown asset is ignored (full list)
 * rather than erroring — a stale client must not break the history screen.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100);
    const asset = parseAsset(url.searchParams.get("asset"));

    const rows = await prisma.transaction.findMany({
      where: asset ? { userId: auth.id, ...assetFilter(asset) } : { userId: auth.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const transactions = rows.map(serializeTransaction);

    return jsonOk({ transactions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
