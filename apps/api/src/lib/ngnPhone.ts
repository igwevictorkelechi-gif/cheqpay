// apps/api/src/lib/ngnPhone.ts
//
// Normalising a Nigerian mobile number before it reaches a provider.
//
// Bill purchases used to send the customer's number exactly as typed. People
// type "0701 499 8301", "+2347014998301", "234 701 499 8301" and "7014998301"
// for the same line, and whether a provider accepts each spelling is its own
// business — so a purchase could fail on formatting alone, after the customer
// had been debited.
//
// Everything is reduced to the local 0XXXXXXXXXX form, which is what Maplerad
// has been observed accepting on a live airtime purchase. (Its own history
// endpoint echoes numbers back as +234…, but echoing a format is not the same
// as requiring it, and the local form is the one we have actually seen work.)

/** The 0XXXXXXXXXX local form, or null when it is not a Nigerian mobile. */
export function normaliseNgnPhone(input: string | null | undefined): string | null {
  if (!input) return null;

  // Strip everything a human might type as separators, keeping a leading +.
  const cleaned = input.trim().replace(/[\s()\-.]/g, "");
  const digits = cleaned.replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;

  let local: string;
  if (digits.startsWith("234")) {
    // +2347014998301 / 2347014998301 -> 07014998301
    local = `0${digits.slice(3)}`;
  } else if (digits.startsWith("0")) {
    local = digits;
  } else {
    // 7014998301 -> 07014998301
    local = `0${digits}`;
  }

  // A Nigerian mobile is 11 digits in local form and never starts 00.
  if (!/^0[789]\d{9}$/.test(local)) return null;
  return local;
}

/**
 * Normalise for sending, falling back to the original when it is not a shape we
 * recognise. Deliberately non-destructive: refusing an unusual-but-valid number
 * would block a purchase we could otherwise have made, and the provider gets
 * the final say on what it accepts.
 */
export function phoneForProvider(input: string): string {
  return normaliseNgnPhone(input) ?? input.trim();
}
