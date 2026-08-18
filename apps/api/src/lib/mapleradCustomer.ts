import { prisma } from "@cheqpay/db";
import {
  createCustomer,
  enrollCustomer,
  getCustomer,
  hasTier1Evidence,
  upgradeCustomerTier1,
} from "./maplerad/customers";
import { MapleradError } from "./maplerad/client";

/**
 * Give a user a Maplerad customer record, and lift it to tier 1 when we hold
 * enough identity evidence to do so.
 *
 * Maplerad splits this into two calls and so does this function:
 *
 *   POST  /customers                 name + email + country  -> tier 0
 *   PATCH /customers/upgrade/tier1   BVN, dob, phone, address -> tier 1
 *
 * That split matters. The previous version made a single call carrying the full
 * identity, so a user missing any one field ended up with no customer record at
 * all — and every downstream feature failed with "no Maplerad customer record
 * yet", which reads as a provider problem rather than as four missing form
 * fields. Now the record always exists and only the upgrade is conditional.
 *
 * Tier 1 is what collections require, so an NGN deposit account still needs the
 * upgrade to have succeeded. The difference is that the upgrade can be retried
 * on its own, from data already on the user, without asking them to fill the
 * KYC form a second time.
 *
 * Best-effort throughout: a Maplerad outage must never fail a user's KYC.
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
  /**
   * Government ID for the full enrol. `imageUrl` is a fetchable URL to the front
   * document image (a short-lived signed URL, minted by the caller at enrol
   * time), because Maplerad fetches it once during enrolment.
   */
  identity?: {
    type: "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE";
    number: string;
    imageUrl: string;
  };
}

/**
 * Columns added at runtime — migrations are not applied on deploy here.
 *
 * ⚠️ MUST be called from instrumentation.ts at boot, not only from
 * ensureMapleradCustomer below. Prisma emits every column the User model
 * declares on every query of that model, so from the moment `mapleradTier` and
 * the address fields joined the schema, EVERY query returning a User selected
 * them — /api/me, the admin user list, KYC, virtual accounts, transfers.
 *
 * Calling this only from the enrolment path created a deadlock: the sole thing
 * that could create the columns was a KYC submission, and the KYC route reads
 * the user (and therefore fails) before it ever reaches enrolment. Nothing
 * could heal it from inside the app. See the long note in instrumentation.ts —
 * this is the second time this exact hazard has bitten, which is why the helper
 * is exported rather than private.
 */
let ensured: Promise<void> | null = null;
export function ensureMapleradSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      // One multi-clause ALTER: Postgres applies it atomically, so the columns
      // cannot end up half-added if the process dies partway.
      await prisma.$executeRawUnsafe(`
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS maplerad_tier INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS address_street TEXT,
          ADD COLUMN IF NOT EXISTS address_city TEXT,
          ADD COLUMN IF NOT EXISTS address_state TEXT,
          ADD COLUMN IF NOT EXISTS address_postal_code TEXT`);
    })().catch((err) => {
      // Let a later call try again rather than caching the failure forever.
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

/**
 * Government-ID columns on the user, created at runtime for the same reason as
 * the Maplerad columns above: Prisma selects every declared column on every User
 * query, so these must exist before the first query, not lazily on first KYC.
 *
 * ⚠️ Like ensureMapleradSchema, MUST be wired into instrumentation.ts at boot.
 * The schema-bootstrap guard test enforces it.
 */
let ensuredKycDoc: Promise<void> | null = null;
export function ensureKycDocSchema(): Promise<void> {
  if (!ensuredKycDoc) {
    ensuredKycDoc = (async () => {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE app_users
          ADD COLUMN IF NOT EXISTS id_doc_type TEXT,
          ADD COLUMN IF NOT EXISTS id_doc_number_ciphertext TEXT,
          ADD COLUMN IF NOT EXISTS id_doc_number_last4 TEXT`);
    })().catch((err) => {
      ensuredKycDoc = null;
      throw err;
    });
  }
  return ensuredKycDoc;
}

export async function ensureMapleradCustomer(
  userId: string,
  email: string,
  input: MapleradEnrollmentInput
): Promise<string | null> {
  await ensureMapleradSchema();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      mapleradCustomerId: true,
      mapleradTier: true,
      addressStreet: true,
      addressCity: true,
      addressState: true,
      addressPostalCode: true,
    },
  });
  if (!user) return null;

  let customerId = user.mapleradCustomerId;
  // Local mirror of the tier so an enrol that lands tier 1+ in this call is seen
  // by Step 2 below, which would otherwise re-decide from the stale fetched row.
  let tier = user.mapleradTier;

  // Resolved once, up front, because both the full enrol (Step 1) and the tier 1
  // upgrade (Step 2) need it. Falls back to the address already on file so a
  // retry needs nothing new from the user.
  const address =
    input.address ??
    (user.addressStreet && user.addressCity && user.addressState && user.addressPostalCode
      ? {
          street: user.addressStreet,
          city: user.addressCity,
          state: user.addressState,
          postalCode: user.addressPostalCode,
        }
      : undefined);
  const dob = input.dateOfBirth ? toMapleradDob(input.dateOfBirth) : null;
  const phone = input.phone ? toMapleradPhone(input.phone) : null;

  // ---- Step 1: the customer record itself ---------------------------------
  if (!customerId) {
    // Happy path: when we hold the complete identity, enrol in one call for a
    // customer with access to all Maplerad resources (incl. Issuing). Otherwise
    // fall back to the tier 0 create so a customer record always exists, and let
    // Step 2 upgrade it once the rest arrives.
    const canEnrollFull = Boolean(input.bvn && dob && phone && address);
    try {
      if (canEnrollFull) {
        const customer = await enrollCustomer({
          first_name: input.firstName,
          last_name: input.lastName,
          email,
          country: "NG",
          identification_number: input.bvn!,
          dob: dob!,
          phone: phone!,
          address: {
            street: address!.street,
            city: address!.city,
            state: address!.state,
            country: "NG",
            postal_code: address!.postalCode,
          },
          // The government ID, when the caller resolved one. Only the front
          // image is carried — Maplerad's identity takes a single image.
          ...(input.identity
            ? {
                identity: {
                  type: input.identity.type,
                  image: input.identity.imageUrl,
                  number: input.identity.number,
                  country: "NG",
                },
              }
            : {}),
        });
        customerId = customer.id;
        // The enrol response carries the tier (2 in Maplerad's example). Trust
        // it, but never record below tier 1 from a successful full enrol.
        tier = Math.max(1, customer.tier ?? 1);
        await prisma.user.update({
          where: { id: userId },
          data: { mapleradCustomerId: customerId, mapleradTier: tier },
        });
      } else {
        const customer = await createCustomer({
          first_name: input.firstName,
          last_name: input.lastName,
          email,
          country: "NG",
        });
        customerId = customer.id;
        await prisma.user.update({
          where: { id: userId },
          data: { mapleradCustomerId: customerId },
        });
      }
    } catch (err) {
      console.error("[maplerad] could not create the customer (will retry)", {
        userId,
        fullEnroll: canEnrollFull,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  } else {
    // ---- Step 1b: reconcile an id we did not create -----------------------
    //
    // A customer id can arrive here without this code having created it — a
    // customer opened on the Maplerad dashboard has to be pasted into the user
    // row by hand to connect the two. Two things then need checking that a
    // self-created id never does.
    //
    // Whether it exists at all: a mistyped id would wedge the account forever,
    // because every later call fails against an id Maplerad does not have while
    // this function keeps assuming enrolment is done. Clearing it lets the next
    // attempt create a real one.
    //
    // And what tier it actually holds: maplerad_tier is our local cache of
    // Maplerad's state, and a hand-set id arrives with that cache at 0 whatever
    // the truth is. Reading it back means the upgrade decision below is made
    // from Maplerad's own record rather than from our guess.
    try {
      const remote = await getCustomer(customerId);
      if (hasTier1Evidence(remote)) {
        await prisma.user.update({ where: { id: userId }, data: { mapleradTier: 1 } });
        return customerId;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Only a genuine "no such customer" clears the id. A refused or
      // unreachable provider must not discard a good id — that would replace a
      // working link with a new customer on every outage.
      const notFound = err instanceof MapleradError && err.status === 404;
      console.error("[maplerad] could not read back the stored customer", {
        userId,
        customerId,
        notFound,
        error: message,
      });
      if (notFound) {
        await prisma.user.update({
          where: { id: userId },
          data: { mapleradCustomerId: null, mapleradTier: 0 },
        });
        return null;
      }
    }
  }

  // ---- Step 2: the tier 1 upgrade -----------------------------------------
  // `tier` (not user.mapleradTier) so a full enrol above, which may have just
  // landed tier 2, is not followed by a pointless upgrade attempt.
  if (tier >= 1) return customerId;

  // `address`, `dob` and `phone` were resolved once above and are reused here —
  // the address falls back to what is already on file, so the upgrade can be
  // retried later (on a deposit attempt, say) without the user re-entering it.
  const missing: string[] = [];
  if (!input.bvn) missing.push("bvn");
  if (!input.dateOfBirth) missing.push("dateOfBirth");
  if (!input.phone) missing.push("phone");
  if (!address) missing.push("address");
  if (missing.length) {
    // Not an error: the customer exists and can be upgraded as soon as the
    // user supplies the rest.
    console.warn("[maplerad] tier 1 upgrade skipped (incomplete data)", { userId, missing });
    return customerId;
  }

  if (!dob || !phone) {
    console.warn("[maplerad] tier 1 upgrade skipped (unparseable dob/phone)", { userId });
    return customerId;
  }

  try {
    await upgradeCustomerTier1({
      customer_id: customerId,
      identification_number: input.bvn!,
      dob,
      phone,
      address: {
        street: address!.street,
        city: address!.city,
        state: address!.state,
        country: "NG",
        postal_code: address!.postalCode,
      },
    });
    // The response carries no customer object, so the tier is recorded from the
    // call having succeeded rather than read back from the body.
    await prisma.user.update({
      where: { id: userId },
      data: { mapleradTier: 1 },
    });
  } catch (err) {
    console.error("[maplerad] tier 1 upgrade failed (will retry)", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return customerId;
}

/** Persist the address so a later tier 1 upgrade needs nothing from the user. */
export async function rememberAddress(
  userId: string,
  address: { street: string; city: string; state: string; postalCode: string }
): Promise<void> {
  await ensureMapleradSchema();
  await prisma.user.update({
    where: { id: userId },
    data: {
      addressStreet: address.street,
      addressCity: address.city,
      addressState: address.state,
      addressPostalCode: address.postalCode,
    },
  });
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
