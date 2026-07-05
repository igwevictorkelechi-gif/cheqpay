import { prisma, KycStatus } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getTierLimits } from "@/lib/kyc";
import { getKycProvider } from "@/kyc";
import { sendPush } from "@/lib/push";
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

    // Automated identity check (BVN/ID). Passing auto-approves; otherwise the
    // submission stays PENDING for manual admin review.
    const verdict = await getKycProvider().verify({
      firstName: body.firstName,
      lastName: body.lastName,
      dateOfBirth: body.dateOfBirth,
      bvn: body.bvn,
      documentRefs: body.documentRefs,
    });

    const record = await prisma.kycRecord.create({
      data: {
        userId: auth.id,
        tier: verdict.verified ? verdict.tier : 1,
        status: verdict.verified ? KycStatus.APPROVED : KycStatus.PENDING,
        reviewedAt: verdict.verified ? new Date() : null,
        documentRefs: body.documentRefs,
      },
    });

    // Persist the submitted date of birth on the profile so Personal details
    // can show it (it becomes locked once the account is verified).
    if (body.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(body.dateOfBirth)) {
      await prisma.user.update({
        where: { id: auth.id },
        data: { dateOfBirth: new Date(body.dateOfBirth) },
      });
    }

    // Elevate the user's tier immediately on an automatic pass.
    if (verdict.verified) {
      await prisma.user.update({
        where: { id: auth.id },
        data: { kycTier: { set: Math.max(user.kycTier, verdict.tier) } },
      });
      await sendPush(auth.id, {
        category: "security",
        title: "Identity verified",
        body: "Your KYC is approved. Your limits are raised and withdrawals are unlocked.",
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: verdict.verified ? "kyc.auto_approved" : "kyc.submitted",
        resourceType: "KycRecord",
        resourceId: record.id,
        details: {
          firstName: body.firstName,
          lastName: body.lastName,
          dateOfBirth: body.dateOfBirth,
          country: body.country,
          hasBvn: !!body.bvn,
          documentCount: body.documentRefs.length,
          verified: verdict.verified,
          reason: verdict.reason,
        },
      },
    });

    return jsonOk(
      {
        id: record.id,
        status: record.status,
        tier: verdict.verified ? Math.max(user.kycTier, verdict.tier) : user.kycTier,
        autoVerified: verdict.verified,
        message: verdict.reason,
      },
      201
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
