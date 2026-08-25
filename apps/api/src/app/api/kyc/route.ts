import { prisma, KycStatus } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { getTierLimits } from "@/lib/kyc";
import { getKycProvider } from "@/kyc";
import { sendPush } from "@/lib/push";
import { createVirtualAccount } from "@/lib/virtualAccounts";
import { ensureMapleradCustomer } from "@/lib/mapleradCustomer";
import { pregenerateCryptoWallets } from "@/lib/pregenerateWallets";
import { persistKycIdentity } from "@/lib/kycIdentity";
import { grantTierFromEnrolment } from "@/lib/kycAutoTier";
import { upgradeToTier2 } from "@/lib/mapleradTier2";
import {
  kycDocumentOwner,
  markKycDocumentSubmitted,
  resolveApiOrigin,
  signKycDocumentUrl,
} from "@/lib/kycDocuments";
import { kycTier1Schema } from "@/lib/validation";
import { decryptPii, isPiiEncryptionConfigured } from "@/lib/pii";

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

    // The document refs made a round trip through the client, so check the
    // caller owns them before anything is stored or signed. Without this, a
    // submission could attach somebody else's ID images to its own KYC record —
    // and the admin reviewer would then be shown those images as this user's.
    for (const ref of [body.identity.frontRef, body.identity.backRef]) {
      if (kycDocumentOwner(ref) !== auth.id) {
        throw new ApiError(
          422,
          "Those ID uploads don't belong to this account — please upload them again",
          "bad_document_ref"
        );
      }
    }

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

    // Store everything the user submitted, securely, BEFORE anything is checked
    // against Maplerad. This is the first side effect of the submission and it is
    // allowed to fail loudly: if we cannot record who submitted what, we must not
    // go on to ask the provider about them. The BVN is stored encrypted; the
    // phone is filled only when empty. See lib/kycIdentity.ts.
    await persistKycIdentity(auth.id, {
      legalName: `${body.firstName} ${body.lastName}`.trim(),
      bvn: body.bvn,
      dateOfBirth: body.dateOfBirth,
      phone: body.phone,
      address: body.address,
      idDoc: { type: body.identity.type, number: body.identity.number },
    });

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
        // The two ID-document storage paths (front, back). These are what an
        // admin reviewer opens; the images themselves stay in the private bucket.
        documentRefs: [body.identity.frontRef, body.identity.backRef],
      },
    });

    // Date of birth, legal name, encrypted BVN and address were all written by
    // persistKycIdentity above, before any provider call — so nothing needs
    // storing here.

    // Enrollment is attempted for anyone who ENDS UP verified, not only those
    // verified by this submission. A user who verified before the form asked
    // for phone and address is verified but not enrolled, and would otherwise
    // never get a deposit account or a crypto wallet — the approved screen
    // never shows them the form again. Re-submitting the missing details now
    // completes their setup.
    //
    // Enrolment is NO LONGER gated on the registry lookup succeeding. That gate
    // meant a failed lookup denied the user a provider customer entirely — and
    // the lookup is currently refused for this account (POST /identity/bvn
    // returns Unauthorized while POST /customers/enroll succeeds on the same
    // key), so no new user could be enrolled at all. Enrolment is itself an
    // identity check: Maplerad rejects a BVN, name and date of birth that do not
    // hang together. Attempting it for every complete submission is what lets a
    // user reach tier 1 without a lookup we cannot currently make. Everything
    // inside is best-effort and idempotent, so a repeat submission is safe.
    const alreadyVerified = user.kycTier >= 1;
    {
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
      //
      // The address is already on the profile — persistKycIdentity wrote it
      // above — so ensureMapleradCustomer can fall back to it on a later retry
      // even when this submission omitted it.

      // A fresh, short-lived signed URL for the front ID image, resolved here so
      // a later retry re-signs rather than depending on a stale URL. Best-effort:
      // if signing fails, enroll without the identity block rather than failing
      // the whole KYC — the customer is still created and the ID is on file.
      let identity: { type: typeof body.identity.type; number: string; imageUrl: string } | undefined;
      try {
        const imageUrl = signKycDocumentUrl(body.identity.frontRef, 3600, resolveApiOrigin(req));
        identity = { type: body.identity.type, number: body.identity.number, imageUrl };
      } catch (err) {
        console.error("[kyc] could not sign the ID document for enrollment", err);
      }

      // `bvn` was recovered above, before the identity check, so that a
      // Maplerad-backed check sees the same value this enrollment does.
      //
      // Idempotent: when the check above already enrolled the user this finds
      // the persisted customer id and returns without calling the provider.
      const customerId = await ensureMapleradCustomer(auth.id, user.email, {
        firstName: body.firstName,
        lastName: body.lastName,
        bvn,
        dateOfBirth: body.dateOfBirth ?? user.dateOfBirth?.toISOString().slice(0, 10),
        phone: body.phone ?? user.phone,
        address: body.address,
        identity,
      });

      // Mint the crypto deposit addresses now rather than when the user first
      // opens Receive: the customer they hang off has just been created, and
      // doing it here means no provider round-trip while someone waits. Never
      // blocks or fails this request.
      if (customerId) {
        pregenerateCryptoWallets(auth.id, "kyc_enrolment");
      }

      // The documents have now been part of a submission the provider accepted,
      // so mark them submitted — until now they were "uploaded, not sent
      // anywhere". Gated on `identity` as well as the customer id because without
      // it there was no image to send. The ref is unchanged (the row stays put;
      // only its flag flips), so KycRecord.documentRefs need no rewrite. See
      // lib/kycDocuments.ts. Best-effort, like the deposit account below: a
      // storage hiccup must not fail a KYC that has already succeeded, and the
      // next submission marks whatever was left behind.
      if (customerId && identity) {
        try {
          await Promise.all(
            [body.identity.frontRef, body.identity.backRef].map(markKycDocumentSubmitted)
          );
        } catch (err) {
          console.error("[kyc] could not mark the ID documents submitted", err);
        }
      }

      // Go straight on to tier 2 while the government ID is in hand. Tier 2 is
      // what raises limits and unlocks crypto withdrawals, and it needs exactly
      // what this submission just stored — an ID type, number and document
      // image. Best-effort by contract: a refusal leaves the user at tier 1 with
      // a working deposit account, and the admin page can retry.
      if (customerId) {
        const tier2 = await upgradeToTier2(auth.id, resolveApiOrigin(req));
        if (!tier2.upgraded) {
          console.warn("[kyc] tier 2 not granted", { userId: auth.id, reason: tier2.reason });
        }
      }

      // Internal KYC tier from the provider's verdict. The enrolment and the
      // tier 2 attempt above have both written the customer's tier by now, so
      // this reads the result rather than guessing. Only ever raises, never
      // past 2, and mirrors whatever tier the provider actually reached.
      const promotion = await grantTierFromEnrolment(auth.id);
      if (promotion.granted) {
        console.info("[kyc] tier 1 granted from the provider enrolment", { userId: auth.id });
      }

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
          // The government ID: type only, never the number (that is PII).
          idDocType: body.identity.type,
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
