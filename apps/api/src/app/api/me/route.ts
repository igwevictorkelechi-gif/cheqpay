import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getTierLimits } from "@/lib/kyc";

export const dynamic = "force-dynamic";

/** Return the authenticated user's profile + current tier limits. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }
    return jsonOk(serialize(user));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Provision (or refresh) the app-side profile from the verified token claims.
 * Idempotent: safe to call on every login. Supabase Auth is the credential
 * authority; we mirror id/email/phone and own the KYC tier.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    if (!auth.email) {
      throw new ApiError(400, "Token has no email claim", "missing_email");
    }
    const user = await prisma.user.upsert({
      where: { id: auth.id },
      update: { email: auth.email, phone: auth.phone ?? undefined },
      create: { id: auth.id, email: auth.email, phone: auth.phone ?? null },
    });
    return jsonOk(serialize(user));
  } catch (err) {
    return toErrorResponse(err);
  }
}

function serialize(user: {
  id: string;
  email: string;
  phone: string | null;
  kycTier: number;
  status: string;
  createdAt: Date;
}) {
  const limits = getTierLimits(user.kycTier);
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    kycTier: user.kycTier,
    status: user.status,
    createdAt: user.createdAt,
    limits: {
      singleTxKobo: limits.singleTxKobo.toString(),
      dailyDepositKobo: limits.dailyDepositKobo.toString(),
      dailyWithdrawalKobo: limits.dailyWithdrawalKobo.toString(),
      cryptoWithdrawalEnabled: limits.cryptoWithdrawalEnabled,
    },
  };
}
