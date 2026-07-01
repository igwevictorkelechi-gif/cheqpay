// rebuild api preview to include the admin transactions endpoint
import { prisma, TransactionType } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Admin: paginated transaction list + a 30-day summary
 * (count, completed, failed, success/failure rate, NGN volume).
 * Query params: page, pageSize (<=50), search (ref/txHash), type.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("pageSize") ?? 10) || 10),
    );
    const search = (url.searchParams.get("search") ?? "").trim();
    const typeParam = (url.searchParams.get("type") ?? "").toUpperCase();
    const allowed = Object.values(TransactionType) as string[];
    const typeFilter = allowed.includes(typeParam)
      ? (typeParam as TransactionType)
      : undefined;

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const where = {
      ...(typeFilter ? { type: typeFilter } : {}),
      ...(search
        ? {
            OR: [
              { externalRef: { contains: search, mode: "insensitive" as const } },
              { txHash: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [total, rows, totalLast30, completed, failed, ngnAgg] =
      await Promise.all([
        prisma.transaction.count({ where }),
        prisma.transaction.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { user: { select: { email: true } } },
        }),
        prisma.transaction.count({ where: { createdAt: { gte: since } } }),
        prisma.transaction.count({
          where: { createdAt: { gte: since }, status: "COMPLETED" },
        }),
        prisma.transaction.count({
          where: { createdAt: { gte: since }, status: "FAILED" },
        }),
        prisma.transaction.aggregate({
          _sum: { amount: true },
          where: { asset: "NGN", status: "COMPLETED", createdAt: { gte: since } },
        }),
      ]);

    const transactions = rows.map((t) => ({
      id: t.id,
      userEmail: t.user?.email ?? "—",
      type: t.type,
      asset: t.asset,
      amount: fromMinorUnits(t.amount, t.asset),
      status: t.status,
      reference: t.externalRef ?? t.txHash ?? "—",
      createdAt: t.createdAt.toISOString(),
    }));

    const successRate = totalLast30 > 0 ? (completed / totalLast30) * 100 : 0;
    const failureRate = totalLast30 > 0 ? (failed / totalLast30) * 100 : 0;

    return jsonOk({
      transactions,
      total,
      page,
      pageSize,
      summary: {
        totalLast30,
        completed,
        failed,
        ngnVolumeLast30: fromMinorUnits(ngnAgg._sum.amount ?? 0n, "NGN"),
        successRate: Number(successRate.toFixed(1)),
        failureRate: Number(failureRate.toFixed(1)),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
