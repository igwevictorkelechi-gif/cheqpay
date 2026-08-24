import { prisma } from "@cheqpay/db";
import { upgradeCustomerTier2 } from "./maplerad/customers";
import { ensureKycDocSchema, ensureMapleradSchema } from "./mapleradCustomer";
import { decryptPii, isPiiEncryptionConfigured } from "./pii";
import { signKycDocumentUrl } from "./kycDocuments";

export interface Tier2Outcome {
  upgraded: boolean;
  tier: number;
  /** Operator-facing explanation — always set, including on the happy path. */
  reason: string;
}

/**
 * Lift a customer from Maplerad tier 1 to tier 2.
 *
 * Tier 2 is what raises transaction limits and unlocks crypto withdrawals, and
 * Maplerad wants a government ID for it: a document image it can fetch, plus the
 * number and country. Everything needed is already stored by the KYC flow — the
 * ID type and encrypted number on the user, and the document refs on the KYC
 * record — so this assembles them rather than asking the user for anything new.
 *
 * Ordering matters: Maplerad will not accept a tier 2 upgrade for a customer
 * that has not reached tier 1, so this refuses early rather than making a call
 * that is certain to fail.
 *
 * Best-effort by contract: never throws. A tier 2 failure must not undo a tier 1
 * enrolment or fail a KYC submission that otherwise succeeded — the user keeps
 * their deposit account and can be upgraded later from the admin page.
 */
export async function upgradeToTier2(
  userId: string,
  origin: string,
): Promise<Tier2Outcome> {
  try {
    await Promise.all([ensureMapleradSchema(), ensureKycDocSchema()]);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        mapleradCustomerId: true,
        mapleradTier: true,
        idDocType: true,
        idDocNumberCiphertext: true,
      },
    });
    if (!user) return { upgraded: false, tier: 0, reason: "no such user" };
    if (!user.mapleradCustomerId) {
      return { upgraded: false, tier: user.mapleradTier, reason: "not enrolled with the provider" };
    }
    if (user.mapleradTier >= 2) {
      return { upgraded: false, tier: user.mapleradTier, reason: "already at tier 2 or above" };
    }
    if (user.mapleradTier < 1) {
      // Maplerad rejects a tier 2 upgrade for a tier 0 customer, so do not spend
      // the call. Reaching tier 1 first is the caller's job.
      return { upgraded: false, tier: user.mapleradTier, reason: "customer is still tier 0 — reach tier 1 first" };
    }

    if (!user.idDocType) {
      return { upgraded: false, tier: user.mapleradTier, reason: "no government ID type on file" };
    }
    if (!user.idDocNumberCiphertext || !isPiiEncryptionConfigured()) {
      return { upgraded: false, tier: user.mapleradTier, reason: "no ID number on file" };
    }

    let idNumber: string;
    try {
      idNumber = decryptPii(user.idDocNumberCiphertext);
    } catch (err) {
      return {
        upgraded: false,
        tier: user.mapleradTier,
        reason: `ID number could not be decrypted: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // The front image, from the most recent submission that actually carried
    // documents. Maplerad's identity block takes a single image.
    const record = await prisma.kycRecord.findFirst({
      where: { userId, documentRefs: { isEmpty: false } },
      orderBy: { createdAt: "desc" },
      select: { documentRefs: true },
    });
    const frontRef = record?.documentRefs?.[0];
    if (!frontRef) {
      return { upgraded: false, tier: user.mapleradTier, reason: "no ID document image on file" };
    }

    // A fresh, short-lived URL: Maplerad fetches the image once during the
    // upgrade, so it only has to be valid for the length of this call.
    let imageUrl: string;
    try {
      imageUrl = signKycDocumentUrl(frontRef, 3600, origin);
    } catch (err) {
      return {
        upgraded: false,
        tier: user.mapleradTier,
        reason: `could not sign the ID document: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    await upgradeCustomerTier2({
      customer_id: user.mapleradCustomerId,
      identity: {
        type: user.idDocType as "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE",
        image: imageUrl,
        number: idNumber,
        country: "NG",
      },
    });

    // The call succeeded, so record the tier. The response body carries only
    // { id, status }, never a tier, so it cannot be read back from there.
    await prisma.user.update({ where: { id: userId }, data: { mapleradTier: 2 } });

    return { upgraded: true, tier: 2, reason: "provider accepted the government ID" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[maplerad] tier 2 upgrade failed (will retry)", { userId, reason });
    return { upgraded: false, tier: 0, reason: `provider refused the upgrade: ${reason}` };
  }
}
