import { prisma, KycStatus } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getTierLimits } from "@/lib/kyc";
import { kycTier1Schema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** List the user's KYC records + current tier/limits. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const [user, records] = await Promise.all([
      prisma.user.findUnique({ where: { id: auth.id } }),
      prisma.kycRecord.findMany({
        where: { userId: auth.id },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }
    const limits = getTierLimits(user.kycTier);
    return jsonOk({
      kycTier: user.kycTier,
      limits: {
        singleTxKobo: limits.singleTxKobo.toString(),
        dailyDepositKobo: limits.dailyDepositKobo.toString(),
        dailyWithdrawalKobo: limits.dailyWithdrawalKobo.toString(),
        cryptoWithdrawalEnabled: limits.cryptoWithdrawalEnabled,
      },
      records,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Submit tier-1 KYC (minimal info). Creates a PENDING record. Tier elevation
 * happens on approval (admin/automated review) in a later phase — we never
 * self-approve here.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    const body = kycTier1Schema.parse(await req.json());

    const record = await prisma.kycRecord.create({
      data: {
        userId: auth.id,
        tier: 1,
        status: KycStatus.PENDING,
        documentRefs: body.documentRefs,
      },
    });

    // Append-only audit trail of the submission.
    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: "kyc.tier1.submitted",
        resourceType: "KycRecord",
        resourceId: record.id,
        details: {
          fullName: body.fullName,
          dateOfBirth: body.dateOfBirth,
          country: body.country,
          documentCount: body.documentRefs.length,
        },
      },
    });

    return jsonOk({ id: record.id, status: record.status, tier: record.tier }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
