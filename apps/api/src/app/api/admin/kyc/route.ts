import { KycStatus, prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { sendPush } from "@/lib/push";
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
    const actorInfo = await requireAdminActor(req);
    const actor = actorInfo.email;
    const { recordId, action, tier } = kycReviewSchema.parse(await req.json());

    const record = await prisma.kycRecord.findUnique({ where: { id: recordId } });
    if (!record) throw new ApiError(404, "KYC record not found", "not_found");

    const grantTier = tier ?? 2;
    const approving = action === "approve";

    // Approving raises limits and unlocks withdrawals: a fresh authenticator
    // code, and tier 3 (enhanced due diligence) is a Super Admin's call.
    // Rejecting takes nothing away from the platform and needs neither.
    if (approving) {
      if (grantTier >= 3 && actorInfo.role !== "super") {
        throw new ApiError(403, "Only a Super Admin can grant tier 3.", "super_only");
      }
      await requireAdminOtp(req);
    }

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

    if (approving) {
      const owner = await prisma.user.findUnique({ where: { id: record.userId }, select: { email: true } });
      await recordAdminAction(req, actorInfo, {
        action: "admin.kyc.approved",
        summary: `KYC approved at tier ${grantTier} for ${owner?.email ?? record.userId}`,
        userId: record.userId,
        resourceType: "KycRecord",
        resourceId: recordId,
        details: { tier: grantTier },
      });
    }

    await sendPush(record.userId, {
      category: "security",
      title: approving ? "Identity verified" : "KYC needs attention",
      body: approving
        ? "Your KYC was approved. Your limits are raised and withdrawals are unlocked."
        : "Your KYC submission was not approved. Please review and resubmit.",
    });

    return jsonOk({
      recordId,
      status: approving ? KycStatus.APPROVED : KycStatus.REJECTED,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
