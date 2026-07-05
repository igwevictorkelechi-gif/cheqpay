import { Prisma, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getTierLimits } from "@/lib/kyc";
import { getEnv } from "@/lib/env";
import { profileUpdateSchema } from "@/lib/validation";

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

/**
 * Update editable profile fields (username, next of kin, and — while the
 * account is not yet verified — date of birth). Verified users can't change
 * their DOB; identity edits go through support.
 */
export async function PATCH(req: Request) {
  try {
    const auth = await requireUser(req);
    const patch = profileUpdateSchema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      throw new ApiError(404, "Profile not provisioned; POST /api/me first", "no_profile");
    }

    const data: Prisma.UserUpdateInput = {};
    if (patch.username !== undefined) data.username = patch.username;
    if (patch.nextOfKin !== undefined) data.nextOfKin = patch.nextOfKin;
    if (patch.dateOfBirth !== undefined) {
      if (user.kycTier >= 2) {
        throw new ApiError(403, "Date of birth is locked on verified accounts", "dob_locked");
      }
      data.dateOfBirth = new Date(patch.dateOfBirth);
    }

    try {
      const updated = await prisma.user.update({ where: { id: auth.id }, data });
      return jsonOk(serialize(updated));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ApiError(409, "That username is already taken", "username_taken");
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Permanently delete the authenticated user's account. Cascades to wallets,
 * balances, quotes, transactions and KYC records (audit logs are retained with
 * a null user). When Supabase service-role env is configured, the Auth user is
 * deleted too so the credentials cannot be used to sign in again.
 *
 * This is irreversible and money-sensitive: it refuses to run while the user
 * still holds a positive balance.
 */
export async function DELETE(req: Request) {
  try {
    const auth = await requireUser(req);
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) {
      // Already gone — treat as success so the client can finish signing out.
      return jsonOk({ deleted: true });
    }

    const balances = await prisma.balance.findMany({ where: { userId: auth.id } });
    const hasFunds = balances.some((b) => b.available > 0n || b.locked > 0n);
    if (hasFunds) {
      throw new ApiError(
        409,
        "Withdraw your remaining balance before deleting your account",
        "nonzero_balance"
      );
    }

    // Keep an audit trail of the deletion (userId is nulled by the cascade).
    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: "account.deleted",
        resourceType: "User",
        resourceId: auth.id,
        details: { email: user.email },
      },
    });

    await prisma.user.delete({ where: { id: auth.id } });
    await deleteSupabaseAuthUser(auth.id);

    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Best-effort deletion of the Supabase Auth user via the Admin API. */
async function deleteSupabaseAuthUser(userId: string): Promise<void> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
  } catch (err) {
    console.error("[account] Supabase auth deletion failed", err);
  }
}

function serialize(user: {
  id: string;
  email: string;
  phone: string | null;
  kycTier: number;
  status: string;
  createdAt: Date;
  username?: string | null;
  dateOfBirth?: Date | null;
  nextOfKin?: string | null;
  instantWithdrawal?: boolean;
}) {
  const limits = getTierLimits(user.kycTier);
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    kycTier: user.kycTier,
    status: user.status,
    createdAt: user.createdAt,
    instantWithdrawal: user.instantWithdrawal ?? false,
    username: user.username ?? null,
    // Serialize DOB as a plain YYYY-MM-DD date (no timezone shifting).
    dateOfBirth: user.dateOfBirth
      ? user.dateOfBirth.toISOString().slice(0, 10)
      : null,
    nextOfKin: user.nextOfKin ?? null,
    limits: {
      singleTxKobo: limits.singleTxKobo.toString(),
      dailyDepositKobo: limits.dailyDepositKobo.toString(),
      dailyWithdrawalKobo: limits.dailyWithdrawalKobo.toString(),
      cryptoWithdrawalEnabled: limits.cryptoWithdrawalEnabled,
    },
  };
}
