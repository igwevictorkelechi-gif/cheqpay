import { KycStatus, prisma } from "@cheqpay/db";

/**
 * Grant internal KYC tier 1 off the back of a successful provider enrolment.
 *
 * Why this exists. Internal kycTier (which sets transaction limits) was only
 * ever granted by the BVN registry lookup in the KYC route. That lookup is
 * currently refused for this account — `POST /identity/bvn` returns Unauthorized
 * while `POST /customers/enroll` succeeds on the same key — so every submission
 * fell through to manual review and users sat at tier 0 with a working NUBAN
 * they were not allowed to use.
 *
 * Reaching Maplerad tier 1 is itself a real identity check, not a bypass: the
 * provider accepted the BVN, date of birth, name and address together and issued
 * a collection account against them. Treating that as evidence for tier 1 keeps
 * a verified-identity requirement while removing the dependency on a lookup
 * endpoint we cannot currently call.
 *
 * Deliberately conservative:
 *  - Only ever RAISES the tier, and only to 1. A tier 2+ user is left alone, and
 *    nothing here can undo an admin's decision to lower someone.
 *  - Requires mapleradTier >= 1. A tier-0 customer proves nothing.
 *  - Never throws: this runs after the money-adjacent work is done, and a
 *    failure to promote must not fail a KYC submission that otherwise worked.
 */
export async function grantTierFromEnrolment(userId: string): Promise<{
  granted: boolean;
  tier: number;
  reason: string;
}> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { kycTier: true, mapleradTier: true },
    });
    if (!user) return { granted: false, tier: 0, reason: "no such user" };

    if (user.mapleradTier < 1) {
      return {
        granted: false,
        tier: user.kycTier,
        reason: "provider customer is still tier 0",
      };
    }
    if (user.kycTier >= 1) {
      return {
        granted: false,
        tier: user.kycTier,
        reason: "already at tier 1 or above",
      };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { kycTier: 1 },
    });

    // Approve the submission that is sitting in review, so the admin page and
    // the user's own status stop saying PENDING for an account that now holds
    // tier 1. Only the newest one, and only if it is actually pending — a
    // REJECTED record is an operator's explicit decision and is left alone.
    const pending = await prisma.kycRecord.findFirst({
      where: { userId, status: KycStatus.PENDING },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (pending) {
      await prisma.kycRecord.update({
        where: { id: pending.id },
        data: { status: KycStatus.APPROVED, reviewedAt: new Date() },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action: "kyc.auto_approved.provider_enrolment",
        resourceType: "user",
        resourceId: userId,
        details: {
          grantedTier: 1,
          mapleradTier: user.mapleradTier,
          basis:
            "Maplerad accepted the full identity (BVN, date of birth, name, address) and enrolled the customer at tier 1 or above.",
        },
      },
    });

    return { granted: true, tier: 1, reason: "granted from provider enrolment" };
  } catch (err) {
    console.error("[kyc] could not grant tier from enrolment", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { granted: false, tier: 0, reason: "error (logged)" };
  }
}
