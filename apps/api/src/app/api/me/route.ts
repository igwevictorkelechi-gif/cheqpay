import { Prisma, prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getTierLimits } from "@/lib/kyc";
import { getEnv } from "@/lib/env";
import { profileUpdateSchema } from "@/lib/validation";
import { assignUsernameIfMissing, ensureUsernameCaseIndex } from "@/lib/username";
import { closeAccountWithRetention } from "@/lib/retention";

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
    // Phone is unique; if the token's phone already belongs to another account
    // (or collides), provision without it rather than failing the whole login.
    const withPhone = auth.phone ?? undefined;
    let user;
    try {
      user = await prisma.user.upsert({
        where: { id: auth.id },
        update: { email: auth.email, phone: withPhone },
        create: { id: auth.id, email: auth.email, phone: auth.phone ?? null },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        user = await prisma.user.upsert({
          where: { id: auth.id },
          update: { email: auth.email },
          create: { id: auth.id, email: auth.email, phone: null },
        });
      } else {
        throw e;
      }
    }

    // Every account needs a username or it cannot receive a P2P transfer —
    // there is no other way to address one. Assigned here rather than at
    // signup so existing accounts, which predate this, are healed the next
    // time they open the app (clients call this on nearly every screen).
    // Best-effort: a failure here must never block a login.
    if (!user.username) {
      try {
        await ensureUsernameCaseIndex();
        const assigned = await assignUsernameIfMissing(user.id, user.email);
        if (assigned) user = { ...user, username: assigned };
      } catch (err) {
        console.error("[me] username assignment skipped", err);
      }
    }

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
    if (patch.username !== undefined) {
      // Case-insensitive uniqueness is enforced by an index, not by Prisma:
      // without it "victor" would be accepted alongside an existing "Victor".
      await ensureUsernameCaseIndex();
      data.username = patch.username;
    }
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
 * Close the authenticated user's account.
 *
 * NOT a hard delete, deliberately. Transaction and KycRecord both cascade on
 * user deletion, so `prisma.user.delete` would erase the transaction and KYC
 * history that Nigeria's MLPPA 2022 and the CBN AML/CFT regulations require to
 * be retained for five years — precisely the records an investigation needs.
 * Instead the identity is snapshotted, the live profile is scrubbed, and the
 * ledger is left intact. See lib/retention.ts.
 *
 * What the user gets is what they asked for: their personal data is removed
 * from the running service and their credentials stop working.
 *
 * Money-sensitive: refuses while the user still holds a balance.
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

    // Revoke access FIRST. If this fails the account must stay open: telling
    // someone their account is closed while their credentials still work is
    // worse than refusing, and it is what the old implementation did.
    await deleteSupabaseAuthUser(auth.id);

    const { retainUntil } = await closeAccountWithRetention(auth.id);

    // Survives via AuditLog.onDelete: SetNull, and here the user row survives
    // anyway, so the trail stays attributable.
    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: "account.closed",
        resourceType: "User",
        resourceId: auth.id,
        details: {
          email: user.email,
          retainUntil: retainUntil.toISOString(),
          note: "Profile scrubbed; transaction and KYC history retained for AML.",
        },
      },
    });

    return jsonOk({
      deleted: true,
      // The NDPA requires telling people how long records are kept and why.
      recordsRetainedUntil: retainUntil.toISOString(),
      retentionReason:
        "Transaction and identity records are kept for 5 years as required by Nigerian anti-money-laundering law.",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Delete the Supabase Auth user so the credentials stop working.
 *
 * Throws on failure. It used to swallow everything and let the caller report
 * success regardless — and because `fetch` does not throw on HTTP errors, a
 * wrong service-role key produced a 401 that nothing looked at. The user was
 * told their account was deleted while they could still sign straight back in.
 */
async function deleteSupabaseAuthUser(userId: string): Promise<void> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new ApiError(
      503,
      "Account closure is temporarily unavailable. Please contact support.",
      "auth_admin_not_configured"
    );
  }

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
  } catch (err) {
    console.error("[account] Supabase auth deletion failed", err);
    throw new ApiError(
      502,
      "Could not close the account right now. Please try again.",
      "auth_delete_failed"
    );
  }

  // 404 means the auth user is already gone — the desired end state.
  if (!res.ok && res.status !== 404) {
    console.error(`[account] Supabase auth deletion returned ${res.status}`);
    throw new ApiError(
      502,
      "Could not close the account right now. Please try again.",
      "auth_delete_failed"
    );
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
