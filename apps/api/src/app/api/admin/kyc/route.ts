import { KycStatus, prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { kycReviewSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Admin: list KYC submissions for review. `?status=PENDING|APPROVED|REJECTED`
 * (defaults to PENDING) plus per-status counts for the queue badges.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const statusParam = (url.searchParams.get("status") ?? "PENDING").toUpperCase();
    const status = (["PENDING", "APPROVED", "REJECTED"] as const).includes(
      statusParam as KycStatus
    )
      ? (statusParam as KycStatus)
      : KycStatus.PENDING;

    const [records, pending, approved, rejected] = await Promise.all([
      prisma.kycRecord.findMany({
        where: { status },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { user: { select: { id: true, email: true, phone: true, kycTier: true } } },
      }),
      prisma.kycRecord.count({ where: { status: KycStatus.PENDING } }),
      prisma.kycRecord.count({ where: { status: KycStatus.APPROVED } }),
      prisma.kycRecord.count({ where: { status: KycStatus.REJECTED } }),
    ]);

    return jsonOk({
      counts: { pending, approved, rejected },
      records: records.map((r) => ({
        id: r.id,
        tier: r.tier,
        status: r.status,
        documentRefs: r.documentRefs,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        user: {
          id: r.user.id,
          email: r.user.email,
          phone: r.user.phone ?? "—",
          kycTier: r.user.kycTier,
        },
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Admin: approve or reject a KYC submission. Approving sets the record to
 * APPROVED and elevates the user's tier (default 2); rejecting marks it
 * REJECTED without changing the tier. Audited.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const actor = req.headers.get("x-admin-actor") ?? "admin";
    const { recordId, action, tier } = kycReviewSchema.parse(await req.json());

    const record = await prisma.kycRecord.findUnique({ where: { id: recordId } });
    if (!record) throw new ApiError(404, "KYC record not found", "not_found");

    const grantTier = tier ?? 2;
    const approving = action === "approve";

    await prisma.$transaction(async (db) => {
      await db.kycRecord.update({
        where: { id: recordId },
        data: {
          status: approving ? KycStatus.APPROVED : KycStatus.REJECTED,
          tier: approving ? grantTier : record.tier,
          reviewedAt: new Date(),
        },
      });
      if (approving) {
        const u = await db.user.findUnique({ where: { id: record.userId } });
        await db.user.update({
          where: { id: record.userId },
          data: { kycTier: { set: Math.max(u?.kycTier ?? 0, grantTier) } },
        });
      }
      await db.auditLog.create({
        data: {
          userId: record.userId,
          action: approving ? "kyc.admin.approved" : "kyc.admin.rejected",
          resourceType: "KycRecord",
          resourceId: recordId,
          details: { actor, tier: approving ? grantTier : record.tier },
        },
      });
    });

    return jsonOk({
      recordId,
      status: approving ? KycStatus.APPROVED : KycStatus.REJECTED,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
