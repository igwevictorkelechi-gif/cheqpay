import { prisma } from "@cheqpay/db";
import { enrollCustomer } from "./maplerad/customers";

/**
 * Enroll a user as a Maplerad customer (tier 1) and persist the customer id.
 *
 * Maplerad's stablecoin API only serves tier-1+ customers, and tier 1 requires
 * the BVN — which this codebase holds only transiently, during KYC submission.
 * So enrollment happens at KYC approval, best-effort: a Maplerad hiccup must
 * never fail the user's KYC. If enrollment is skipped (missing data or provider
 * error) the user simply has no stablecoin wallet yet; it is retried on their
 * next KYC submission.
 *
 * Verified against the sandbox: tier 1 requires names, email, country, BVN,
 * dob (DD-MM-YYYY), phone AND a street address. Identity document + selfie
 * would reach tier 2 but are not needed for stablecoin addresses.
 */
export interface MapleradEnrollmentInput {
  firstName: string;
  lastName: string;
  bvn?: string;
  /** YYYY-MM-DD (our KYC format); converted to Maplerad's DD-MM-YYYY. */
  dateOfBirth?: string;
  /** E.164 or local; digits are split into +234 + subscriber number. */
  phone?: string | null;
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
  };
}

export async function ensureMapleradCustomer(
  userId: string,
  email: string,
  input: MapleradEnrollmentInput
): Promise<string | null> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { mapleradCustomerId: true },
  });
  if (existing?.mapleradCustomerId) return existing.mapleradCustomerId;

  const missing: string[] = [];
  if (!input.bvn) missing.push("bvn");
  if (!input.dateOfBirth) missing.push("dateOfBirth");
  if (!input.phone) missing.push("phone");
  if (!input.address) missing.push("address");
  if (missing.length) {
    // Not an error — the KYC form doesn't collect all of these yet. Log so we
    // can see how many users are skipped once stablecoins matter.
    console.warn("[maplerad] enrollment skipped (incomplete data)", { userId, missing });
    return null;
  }

  const dob = toMapleradDob(input.dateOfBirth!);
  const phone = toMapleradPhone(input.phone!);
  if (!dob || !phone) {
    console.warn("[maplerad] enrollment skipped (unparseable dob/phone)", { userId });
    return null;
  }

  try {
    const customer = await enrollCustomer({
      first_name: input.firstName,
      last_name: input.lastName,
      email,
      country: "NG",
      identification_number: input.bvn!,
      dob,
      phone,
      address: {
        street: input.address!.street,
        city: input.address!.city,
        state: input.address!.state,
        country: "NG",
        postal_code: input.address!.postalCode,
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { mapleradCustomerId: customer.id },
    });
    return customer.id;
  } catch (err) {
    console.error("[maplerad] customer enrollment failed (will retry on next KYC submit)", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** "1988-10-20" -> "20-10-1988" (Maplerad wants DD-MM-YYYY). */
function toMapleradDob(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "+2348031234567" | "08031234567" -> { +234, 8031234567 }. */
function toMapleradPhone(
  raw: string
): { phone_country_code: string; phone_number: string } | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("234") && digits.length === 13) {
    return { phone_country_code: "+234", phone_number: digits.slice(3) };
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return { phone_country_code: "+234", phone_number: digits.slice(1) };
  }
  if (digits.length === 10) {
    return { phone_country_code: "+234", phone_number: digits };
  }
  return null;
}
