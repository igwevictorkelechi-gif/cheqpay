import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Admin dashboard summary:
 * - total custody wallets
 * - active users
 * - pending KYC records
 * - completed NGN volume in the last 24h
 * - the 5 most recent signups
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalWallets, activeUsers, pendingKyc, volumeAgg, recent] =
      await Promise.all([
        prisma.wallet.count(),
        prisma.user.count({ where: { status: "ACTIVE" } }),
        prisma.kycRecord.count({ where: { status: "PENDING" } }),
        prisma.transaction.aggregate({
          _sum: { amount: true },
          where: { asset: "NGN", status: "COMPLETED", createdAt: { gte: since } },
        }),
        prisma.user.findMany({
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, email: true, createdAt: true },
        }),
      ]);

    return jsonOk({
      stats: {
        totalWallets,
        activeUsers,
        pendingKyc,
        dailyVolumeNgn: fromMinorUnits(volumeAgg._sum.amount ?? 0n, "NGN"),
      },
      recentUsers: recent.map((u) => ({
        id: u.id,
        email: u.email,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
