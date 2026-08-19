import { Prisma, prisma } from "@cheqpay/db";
import { buildRetainedIdentity, encryptPii, last4 } from "./pii";
import { ensureRetentionSchema } from "./retention";
import { ensureKycDocSchema, ensureMapleradSchema } from "./mapleradCustomer";

/**
 * Persist everything a KYC submission carries, as the FIRST side effect of the
 * submission — before any call goes to Maplerad.
 *
 * The point is ordering and durability. Identity used to be written after the
 * provider calls, best-effort, with failures swallowed; the phone was never
 * written at all. So a provider hiccup could leave us having asked Maplerad about
 * a person we had not recorded — the exact record an investigation needs first.
 *
 * Now the database is written first and, unlike the old retention block, a
 * failure here THROWS. If we cannot store who submitted what, we must not proceed
 * to check them against the provider. The one exception is the phone (see below),
 * whose own failure mode must not sink the rest of the identity.
 *
 * The BVN is stored encrypted (bvnCiphertext + a searchable fingerprint + last4)
 * via buildRetainedIdentity — never in the clear. Fields are written only when
 * supplied, so a returning user who does not retype the BVN keeps the encrypted
 * copy already on file rather than having it cleared.
 */
export interface KycIdentityInput {
  legalName: string;
  bvn?: string;
  /** YYYY-MM-DD, as the KYC form and API use it. Stored as a real Date. */
  dateOfBirth?: string;
  phone?: string | null;
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
  };
  /**
   * Government ID. The number is regulated PII, stored encrypted like the BVN
   * (ciphertext + last 4), never in the clear.
   */
  idDoc?: {
    type: string;
    number: string;
  };
}

export async function persistKycIdentity(
  userId: string,
  input: KycIdentityInput
): Promise<void> {
  // All three column sets are created lazily (migrations are not applied on
  // deploy), so make sure they exist before writing to them.
  await Promise.all([
    ensureRetentionSchema(),
    ensureMapleradSchema(),
    ensureKycDocSchema(),
  ]);

  // Legal name + encrypted BVN. buildRetainedIdentity never throws and always
  // returns the legal name, so a key problem costs only the BVN. Its `problem`
  // string is operator-facing; log it, don't fail on it.
  const { identity, problem } = buildRetainedIdentity({
    legalName: input.legalName,
    bvn: input.bvn,
  });
  if (problem) console.error(`[kyc] ${problem}`);

  const data: Prisma.UserUpdateInput = { ...identity };

  // Date of birth: stored canonically as a Date. The Maplerad DD-MM-YYYY format
  // is applied only at the call boundary (toMapleradDob), not here.
  if (input.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) {
    data.dateOfBirth = new Date(input.dateOfBirth);
  }

  if (input.address) {
    data.addressStreet = input.address.street;
    data.addressCity = input.address.city;
    data.addressState = input.address.state;
    data.addressPostalCode = input.address.postalCode;
  }

  // Government ID: type in the clear (it is not sensitive), number encrypted and
  // last-4 for display — the same shape as the BVN. Encryption is best-effort:
  // a key problem must not lose the type or fail the whole identity write.
  if (input.idDoc) {
    data.idDocType = input.idDoc.type;
    try {
      data.idDocNumberCiphertext = encryptPii(input.idDoc.number);
      data.idDocNumberLast4 = last4(input.idDoc.number);
    } catch (err) {
      console.error(
        `[kyc] ID document number not encrypted — not retained: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // This write is the guarantee — a failure propagates and stops the KYC flow
  // before any Maplerad call, which is the whole point of persisting first.
  await prisma.user.update({ where: { id: userId }, data });

  // Phone is written separately and defensively: user.phone is UNIQUE and is
  // usually set at signup, so a blind update risks a unique-constraint throw
  // that would sink an otherwise-complete identity write. Only fill it when it
  // is currently empty, and never let its failure fail the submission.
  if (input.phone && input.phone.trim()) {
    try {
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true },
      });
      if (current && !current.phone) {
        await prisma.user.update({
          where: { id: userId },
          data: { phone: input.phone.trim() },
        });
      }
    } catch (err) {
      // A collision (another account already holds this number) or any other
      // phone-specific fault is logged and skipped — the identity above is
      // already safely stored.
      console.warn("[kyc] could not persist phone (kept existing)", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
