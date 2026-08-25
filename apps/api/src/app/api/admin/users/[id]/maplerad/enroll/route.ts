import { prisma } from "@cheqpay/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import {
  decryptPii,
  encryptPii,
  fingerprintPii,
  isPiiEncryptionConfigured,
  last4,
} from "@/lib/pii";
import { ensureMapleradCustomerDetailed, ensureMapleradSchema } from "@/lib/mapleradCustomer";
import { grantTierFromEnrolment } from "@/lib/kycAutoTier";
import { upgradeToTier2 } from "@/lib/mapleradTier2";
import { resolveApiOrigin } from "@/lib/kycDocuments";
import { createVirtualAccount } from "@/lib/virtualAccounts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin repair: set a phone and drive a stuck account up the Maplerad tiers.
 *
 * Why this exists. A KYC submission that carries no phone enrols only at tier 0,
 * and tier 0 gets no NGN collection account. Recovering from that needed the user
 * to submit the whole form again from a client new enough to require a phone —
 * so an account could sit stuck with a complete BVN, date of birth, ID and
 * address, blocked on one missing field. This lets an operator supply just that
 * field and re-run the enrolment from data already on file.
 *
 * It also closes a diagnosis gap. persistKycIdentity writes the phone in its own
 * try/catch and swallows failures, so "no phone was sent" and "the phone was
 * rejected because another account already holds it" looked identical from the
 * outside. Here the collision is checked explicitly and named in the response.
 *
 * It then attempts tier 2 with the government ID already on file — that is what
 * raises limits and unlocks crypto withdrawals — and finally opens the NGN
 * deposit account. Pass tier2: false to stop at tier 1.
 *
 * Idempotent: ensureMapleradCustomer returns the existing customer when one is
 * already enrolled, upgradeToTier2 refuses when the customer is already there,
 * and createVirtualAccount returns the existing account.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const body = (await req.json().catch(() => ({}))) as {
      phone?: unknown;
      createAccount?: unknown;
      /** Set false to stop at tier 1 and skip the government-ID upgrade. */
      tier2?: unknown;
      // Identity corrections. NIBSS validates the BVN against the name and date
      // of birth together, so a correct BVN still fails "could not validate BVN"
      // when the stored name is in the wrong order or the DOB is off by a digit.
      // These let support fix that in place instead of asking the user to redo
      // KYC. Each is optional; anything omitted keeps what is on file.
      firstName?: unknown;
      lastName?: unknown;
      dateOfBirth?: unknown;
      bvn?: unknown;
    };

    await ensureMapleradSchema();
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phone: true,
        legalName: true,
        dateOfBirth: true,
        bvnCiphertext: true,
        addressStreet: true,
        addressCity: true,
        addressState: true,
        addressPostalCode: true,
        mapleradCustomerId: true,
        mapleradTier: true,
      },
    });
    if (!user) throw new ApiError(404, "No such user", "user_not_found");

    // ---- Step 1: the phone -------------------------------------------------
    // Reported rather than swallowed: an operator needs to know whether the
    // number was stored, was already there, or was refused because it belongs
    // to somebody else.
    let phoneOutcome: string;
    let phone = user.phone?.trim() || null;

    if (typeof body.phone === "string" && body.phone.trim()) {
      const digits = body.phone.replace(/\D/g, "").replace(/^234/, "").replace(/^0/, "");
      if (digits.length !== 10) {
        throw new ApiError(
          422,
          "Expected a 10-digit Nigerian subscriber number (e.g. 8031234567)",
          "bad_phone",
        );
      }
      const normalized = `+234${digits}`;

      // user.phone is UNIQUE, so name the clash instead of failing opaquely.
      const clash = await prisma.user.findFirst({
        where: { phone: normalized, NOT: { id } },
        select: { id: true, email: true },
      });
      if (clash) {
        throw new ApiError(
          409,
          `That number already belongs to another account (${clash.email}). ` +
            `Free it there first, or use a different number.`,
          "phone_taken",
        );
      }

      if (phone === normalized) {
        phoneOutcome = "unchanged (already on file)";
      } else {
        await prisma.user.update({ where: { id }, data: { phone: normalized } });
        phoneOutcome = phone ? `replaced ${phone} with ${normalized}` : `stored ${normalized}`;
        phone = normalized;
      }
    } else {
      phoneOutcome = phone
        ? `using the phone on file (${phone})`
        : "none supplied and none on file";
    }

    // ---- Step 2: what we can enrol with ------------------------------------
    let bvn: string | undefined;
    if (user.bvnCiphertext && isPiiEncryptionConfigured()) {
      try {
        bvn = decryptPii(user.bvnCiphertext);
      } catch (err) {
        console.error("[admin] could not decrypt the retained BVN", { userId: id, err });
      }
    }

    let [firstName, ...rest] = (user.legalName ?? "").trim().split(/\s+/);
    let lastName = rest.join(" ");
    let dateOfBirthIso = user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null;

    // ---- Step 2b: identity corrections from the operator -------------------
    //
    // Applied to the stored values AND persisted, so the fix sticks for the
    // deposit account below and for any future retry rather than living only in
    // this request. Each field is validated to the same shape the KYC form
    // enforces, so a repair cannot write a worse value than the user could.
    // A row is written to the audit log naming exactly which fields an admin
    // changed — this is an identity edit on a money account and must be
    // attributable.
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const overrideFirst = str(body.firstName);
    const overrideLast = str(body.lastName);
    const overrideDob = str(body.dateOfBirth);
    const overrideBvn = str(body.bvn);
    const persist: Record<string, unknown> = {};
    const overridden: string[] = [];

    if (overrideFirst || overrideLast) {
      // A name correction must supply both halves — sending only one would
      // leave the other as whatever the mis-split produced, which is the very
      // problem being fixed.
      if (!overrideFirst || !overrideLast) {
        throw new ApiError(
          422,
          "A name correction needs both a first name and a last name.",
          "bad_name",
        );
      }
      if (!/^[A-Za-z][A-Za-z '-]*$/.test(overrideFirst) || !/^[A-Za-z][A-Za-z '-]*$/.test(overrideLast)) {
        throw new ApiError(422, "Names may contain only letters, spaces, apostrophes and hyphens.", "bad_name");
      }
      firstName = overrideFirst;
      lastName = overrideLast;
      rest = [];
      persist.legalName = `${overrideFirst} ${overrideLast}`;
      overridden.push("legal name");
    }

    if (overrideDob) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(overrideDob) || Number.isNaN(Date.parse(overrideDob))) {
        throw new ApiError(422, "Date of birth must be a real date in YYYY-MM-DD form.", "bad_dob");
      }
      dateOfBirthIso = overrideDob;
      persist.dateOfBirth = new Date(overrideDob);
      overridden.push("date of birth");
    }

    if (overrideBvn) {
      if (!/^\d{11}$/.test(overrideBvn)) {
        throw new ApiError(422, "A BVN is exactly 11 digits.", "bad_bvn");
      }
      if (!isPiiEncryptionConfigured()) {
        // Refuse rather than store a BVN in the clear: the three-way encrypted
        // storage is the whole point of how the BVN is held.
        throw new ApiError(
          503,
          "PII encryption is not configured, so a corrected BVN cannot be stored safely.",
          "pii_unconfigured",
        );
      }
      bvn = overrideBvn;
      persist.bvnCiphertext = encryptPii(overrideBvn);
      persist.bvnFingerprint = fingerprintPii(overrideBvn);
      persist.bvnLast4 = last4(overrideBvn);
      overridden.push("BVN");
    }

    if (overridden.length) {
      await prisma.user.update({ where: { id }, data: persist });
      await prisma.auditLog.create({
        data: {
          userId: id,
          action: "admin.kyc.identity_corrected",
          resourceType: "User",
          resourceId: id,
          // Never the values themselves — only which fields moved.
          details: { fields: overridden, actor: req.headers.get("x-admin-actor") ?? "admin" },
        },
      });
    }
    const address =
      user.addressStreet && user.addressCity && user.addressState && user.addressPostalCode
        ? {
            street: user.addressStreet,
            city: user.addressCity,
            state: user.addressState,
            postalCode: user.addressPostalCode,
          }
        : undefined;

    const missing: string[] = [];
    if (!bvn) missing.push("bvn");
    if (!dateOfBirthIso) missing.push("dateOfBirth");
    if (!phone) missing.push("phone");
    if (!address) missing.push("address");
    if (!firstName || !lastName) missing.push("legalName (need a first and last name)");

    if (missing.length) {
      return jsonOk({
        userId: id,
        phoneOutcome,
        enrolled: false,
        missing,
        corrected: overridden.length ? overridden : undefined,
        tier: user.mapleradTier,
        message:
          `Cannot reach tier 1 yet — still missing: ${missing.join(", ")}. ` +
          `Everything else is on file.`,
      });
    }

    // ---- Step 3: enrol / upgrade -------------------------------------------
    // No identity image: this is a repair from stored data, and Maplerad's
    // identity block is not required for the tier-1 upgrade path.
    const enrolment = await ensureMapleradCustomerDetailed(id, user.email, {
      firstName,
      lastName,
      bvn,
      dateOfBirth: dateOfBirthIso!,
      phone,
      address,
    });
    const customerId = enrolment.customerId;

    // ---- Step 3b: tier 2 -----------------------------------------------------
    // Attempted whenever the customer has reached tier 1 and a government ID is
    // on file, unless the caller explicitly opted out. Tier 2 is what raises
    // limits and unlocks crypto withdrawals. Never throws; its reason is
    // reported so an operator can see exactly what is missing.
    let tier2Reason: string | null = null;
    if (body.tier2 !== false) {
      const t2 = await upgradeToTier2(id, resolveApiOrigin(req));
      tier2Reason = t2.reason;
    }

    const after = await prisma.user.findUnique({
      where: { id },
      select: { mapleradCustomerId: true, mapleradTier: true },
    });

    // Internal KYC tier (transaction limits) follows the provider's verdict, so
    // a repaired account is usable rather than holding a NUBAN it is not allowed
    // to transact on. Only ever raises, and never past 2.
    const promotion = await grantTierFromEnrolment(id);

    // ---- Step 4: the NGN deposit account -----------------------------------
    let account: unknown = null;
    let accountError: string | null = null;
    if (body.createAccount !== false && (after?.mapleradTier ?? 0) >= 1) {
      try {
        account = await createVirtualAccount(id, user.email, {
          firstName,
          lastName,
          phone: phone ?? undefined,
          bvn,
        });
      } catch (err) {
        accountError = err instanceof Error ? err.message : String(err);
        console.error("[admin] deposit account provisioning failed", {
          userId: id,
          accountError,
        });
      }
    }

    return jsonOk({
      userId: id,
      phoneOutcome,
      enrolled: Boolean(customerId),
      // Which identity fields this run corrected before enrolling, so the
      // operator sees the fix was applied and what it touched.
      corrected: overridden.length ? overridden : undefined,
      customerId: after?.mapleradCustomerId ?? customerId,
      tierBefore: user.mapleradTier,
      tier: after?.mapleradTier ?? user.mapleradTier,
      kycTier: promotion.tier,
      kycTierGranted: promotion.granted,
      tier2Reason,
      // Why the enrolment stopped, in Maplerad's own words. Without this the
      // operator was told to go and read the API logs, which in practice meant
      // the account stayed stuck.
      enrollError: enrolment.error ?? null,
      enrollStep: enrolment.step ?? null,
      missing: enrolment.missing ?? undefined,
      account,
      accountError,
      message:
        (after?.mapleradTier ?? 0) >= 2
          ? "Customer is at tier 2 — limits raised and crypto withdrawals unlocked."
          : (after?.mapleradTier ?? 0) >= 1
            ? `Customer is at tier 1.${tier2Reason ? ` Tier 2 not granted: ${tier2Reason}.` : ""}`
            : enrolment.error
              ? `Still tier 0 — Maplerad refused${enrolment.step ? ` at the ${enrolment.step} step` : ""}: ${enrolment.error}`
              : "Still tier 0 — the provider did not accept the upgrade, and returned no reason.",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
