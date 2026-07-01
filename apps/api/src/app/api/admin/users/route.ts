import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { fromMinorUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Admin: paginated user list with derived KYC status and NGN balance.
 * Query params: page (1-based), pageSize (<=50), search (email/phone).
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

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          balances: { where: { asset: "NGN" }, select: { available: true } },
          kycRecords: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { status: true },
          },
        },
      }),
    ]);

    const users = rows.map((u) => {
      const ngn = u.balances[0]?.available ?? 0n;
      const kycStatus =
        u.kycRecords[0]?.status ?? (u.kycTier > 0 ? "APPROVED" : "PENDING");
      return {
        id: u.id,
        email: u.email,
        phone: u.phone ?? "—",
        kycStatus,
        kycTier: u.kycTier,
        status: u.status,
        ngnBalance: fromMinorUnits(ngn, "NGN"),
        createdAt: u.createdAt.toISOString(),
      };
    });

    return jsonOk({ users, total, page, pageSize });
  } catch (err) {
    return toErrorResponse(err);
  }
}
