import { Prisma, prisma, KycStatus } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getTierLimits } from "@/lib/kyc";
import { getKycProvider } from "@/kyc";
import { sendPush } from "@/lib/push";
import { createVirtualAccount } from "@/lib/virtualAccounts";
import { ensureMapleradCustomer, rememberAddress } from "@/lib/mapleradCustomer";
import { kycTier1Schema } from "@/lib/validation";
import { buildRetainedIdentity, decryptPii, isPiiEncryptionConfigured } from "@/lib/pii";
import { ensureRetentionSchema } from "@/lib/retention";

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
      // Whether the user is enrolled with the payment provider. Verification
      // and enrollment are separate: a user can be fully verified and still
      // have no provider customer, which leaves them with no deposit account
      // and no crypto wallet. Clients use this to ask for the missing details
      // rather than showing a verified badge over a half-finished account.
      providerEnrolled: Boolean(user.mapleradCustomerId),
      // The name recorded at verification. Returned so a user completing their
      // details doesn't retype it — and, more importantly, so it cannot drift
      // from the name the provider will check against the BVN.
      legalName: user.legalName ?? null,
      // Prefills the date picker so somebody finishing their setup does not
      // scroll back through 25 years to re-enter a date already on file.
      dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
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

    // A returning user completing their details won't retype the BVN, but the
    // identity check needs one. We retained it encrypted at first verification
    // precisely so it can be produced again without asking.
    //
    // Recovered here rather than further down because the verification below
    // needs it too — a BVN-based check has nothing to work with otherwise, and
    // a returning user completing their address would fail verification for
    // want of a number we already hold.
    let bvn = body.bvn;
    if (!bvn && user.bvnCiphertext && isPiiEncryptionConfigured()) {
      try {
        bvn = decryptPii(user.bvnCiphertext);
      } catch (err) {
        console.error("[kyc] could not decrypt the retained BVN for enrollment", err);
      }
    }

    // Automated identity check (BVN/ID). Passing auto-approves; otherwise the
    // submission stays PENDING for manual admin review.
    const verdict = await getKycProvider().verify({
      firstName: body.firstName,
      lastName: body.lastName,
      dateOfBirth: body.dateOfBirth ?? user.dateOfBirth?.toISOString().slice(0, 10),
      bvn,
      documentRefs: body.documentRefs,
    });

    if (!verdict.verified) {
      // A submission that does not auto-verify sends the user to "Under review"
      // and — because enrolment is gated on the verdict — silently denies them a
      // Maplerad customer and therefore a deposit account. The provider's reason
      // is the only thing that distinguishes "the name did not match the BVN
      // registry" from "the lookup was refused because our IP is not
      // whitelisted", and those need opposite fixes.
      //
      // It was reaching the client as `message` and the audit log, but nowhere
      // an operator looks first, so every diagnosis started by guessing.
      //
      // Safe to log: provider reasons never carry the BVN — that is exactly why
      // providerRef holds only the last four digits.
      console.warn("[kyc] not auto-verified — sent to manual review", {
        userId: auth.id,
        provider: getKycProvider().name,
        reason: verdict.reason,
        submittedBvn: bvn ? `…${bvn.slice(-4)}` : "none",
      });
    }

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

    // Persist the identity for AML record-keeping. This is the ONLY moment the
    // legal name and BVN are in hand — they used to pass straight through to
    // the provider and be discarded, leaving the database unable to answer
    // "which account belongs to this person?", which is the first question an
    // investigation asks. The BVN is encrypted; see lib/pii.ts.
    //
    // Best-effort: a failure here must not fail the user's verification. It is
    // logged loudly because an identity we failed to record is a compliance gap.
    try {
      await ensureRetentionSchema();
      // buildRetainedIdentity never throws and always returns the legal name,
      // so a key problem costs the BVN and nothing else. See lib/pii.ts.
      const { identity, problem } = buildRetainedIdentity({
        legalName: `${body.firstName} ${body.lastName}`.trim(),
        bvn: body.bvn,
      });
      if (problem) console.error(`[kyc] ${problem}`);

      await prisma.user.update({
        where: { id: auth.id },
        data: identity satisfies Prisma.UserUpdateInput,
      });
    } catch (err) {
      console.error("[kyc] identity retention failed", err);
    }

    // Enrollment is attempted for anyone who ENDS UP verified, not only those
    // verified by this submission. A user who verified before the form asked
    // for phone and address is verified but not enrolled, and would otherwise
    // never get a deposit account or a crypto wallet — the approved screen
    // never shows them the form again. Re-submitting the missing details now
    // completes their setup.
    const alreadyVerified = user.kycTier >= 1;
    if (verdict.verified || alreadyVerified) {
      if (verdict.verified) {
        await prisma.user.update({
          where: { id: auth.id },
          data: { kycTier: { set: Math.max(user.kycTier, verdict.tier) } },
        });
      }

      // Enroll the user with Maplerad while the BVN is still in hand — the
      // stablecoin API only serves tier-1+ Maplerad customers. Best-effort:
      // skipped when the submission lacks phone/address, retried next submit.
      //
      // This MUST come before the deposit account below: a Maplerad collection
      // account hangs off a customer id, so enrolling second meant every
      // account request went out without one and failed.
      // Keep the address on the profile. Without this the tier 1 upgrade can
      // only ever be attempted during a KYC submission, because the address
      // exists nowhere else — which is why an already-verified user could never
      // be upgraded, and so could never be given a deposit account.
      if (body.address) {
        try {
          await rememberAddress(auth.id, body.address);
        } catch (err) {
          console.error("[kyc] could not persist the address", err);
        }
      }

      // `bvn` was recovered above, before the identity check, so that a
      // Maplerad-backed check sees the same value this enrollment does.
      //
      // Idempotent: when the check above already enrolled the user this finds
      // the persisted customer id and returns without calling the provider.
      await ensureMapleradCustomer(auth.id, user.email, {
        firstName: body.firstName,
        lastName: body.lastName,
        bvn,
        dateOfBirth: body.dateOfBirth ?? user.dateOfBirth?.toISOString().slice(0, 10),
        phone: body.phone ?? user.phone,
        address: body.address,
      });

      // Open the permanent, dedicated NGN deposit account now, using the BVN
      // and name we already have in hand. It's persisted (idempotent) and
      // reused forever — the user never has to re-verify or generate another.
      // Best-effort: a PSP hiccup here must not fail verification; the deposit
      // page will provision one on demand if this didn't land.
      try {
        await createVirtualAccount(auth.id, user.email, {
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone ?? user.phone ?? undefined,
          // The recovered value, not body.bvn: a returning user completing
          // their address does not retype the BVN, and passing undefined here
          // marks a permanent account as temporary.
          bvn,
        });
      } catch (e) {
        console.error("[kyc] virtual account provisioning failed (will retry on deposit)", e);
      }

      // Only for a genuinely new approval — a returning user filling in their
      // address does not need to be told they were verified all over again.
      if (verdict.verified && !alreadyVerified) {
        await sendPush(auth.id, {
          category: "security",
          title: "Identity verified",
          body: "Your KYC is approved. Your limits are raised and withdrawals are unlocked.",
        });
      }
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
