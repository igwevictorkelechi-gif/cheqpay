import { Asset, Network, prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Admin: list users' NGN virtual accounts (dedicated NUBANs). Virtual accounts
 * are stored as FIAT wallet rows — address is the account number, custodyRef
 * carries the provider metadata (see lib/virtualAccounts.ts).
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);

    const rows = await prisma.wallet.findMany({
      where: {
        asset: Asset.NGN,
        network: Network.FIAT,
        ...(q
          ? {
              OR: [
                { address: { contains: q } },
                { user: { email: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: { user: { select: { email: true, kycTier: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return jsonOk({
      virtualAccounts: rows.map((w) => {
        let meta: { bankName?: string; bankCode?: string; permanent?: boolean } = {};
        try {
          meta = JSON.parse(w.custodyRef) as typeof meta;
        } catch {
          /* legacy/opaque ref */
        }
        return {
          id: w.id,
          userId: w.userId,
          email: w.user.email,
          kycTier: w.user.kycTier,
          userStatus: w.user.status,
          accountNumber: w.address,
          bankName: meta.bankName ?? "—",
          bankCode: meta.bankCode ?? null,
          permanent: Boolean(meta.permanent),
          createdAt: w.createdAt,
        };
      }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
