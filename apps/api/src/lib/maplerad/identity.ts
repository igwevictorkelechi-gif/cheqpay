// apps/api/src/lib/maplerad/identity.ts
//
// Identity lookups. Distinct from customers.ts: this asks Maplerad who a BVN
// belongs to, and creates nothing.

import { mapleradRequest } from "./client";
import type { BvnLookup } from "./types";

/**
 * Look a BVN up in the registry and return its details.
 *
 * POST /identity/bvn
 *
 * Read-only — it opens no customer and moves no money, so it is safe to call on
 * every KYC submission. Throws MapleradError when the BVN is not found or the
 * request is refused.
 */
export async function verifyBvn(bvn: string): Promise<BvnLookup> {
  return mapleradRequest<BvnLookup>("/identity/bvn", {
    method: "POST",
    body: { bvn },
  });
}

/**
 * The registry identity, normalised for an operator to read and compare.
 *
 * `verifyBvn` returns the provider's raw shape (typed for the happy path). The
 * admin KYC-repair tool needs something tolerant of the field-name variations
 * NIBSS has been seen returning, a date in our own YYYY-MM-DD form, and the full
 * payload kept for anything not parsed out — so this wraps `verifyBvn` rather
 * than changing its long-standing contract, which the signup KYC gate depends on.
 */
export interface BvnIdentity {
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  /** As NIBSS returns it; normalised to YYYY-MM-DD when the shape is readable. */
  dateOfBirth: string | null;
  phone: string | null;
  gender: string | null;
  /** The full provider payload, so an operator can see anything not parsed out. */
  raw: unknown;
}

type Bag = Record<string, unknown>;
function asBag(v: unknown): Bag {
  return v && typeof v === "object" ? (v as Bag) : {};
}

/** First present, non-empty string across candidate keys, at either nesting. */
function pick(bags: Bag[], keys: string[]): string | null {
  for (const bag of bags) {
    for (const k of keys) {
      const v = bag[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  return null;
}

/**
 * Normalise NIBSS's date of birth to the YYYY-MM-DD our records use.
 *
 * NIBSS has been seen returning DD-MM-YYYY and DD/MM/YYYY as well as ISO. An
 * unrecognised shape is returned untouched rather than dropped — an operator can
 * still read it, and inventing a date would be worse than showing the raw one.
 */
function normaliseDob(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

/** Look a BVN up and return the registry identity in the normalised shape. */
export async function lookupBvnIdentity(bvn: string): Promise<BvnIdentity> {
  const res = await verifyBvn(bvn);

  const root = asBag(res);
  const data = asBag(root.data);
  const bags = [data, root];

  return {
    firstName: pick(bags, ["first_name", "firstName", "firstname"]),
    lastName: pick(bags, ["last_name", "lastName", "lastname", "surname"]),
    middleName: pick(bags, ["middle_name", "middleName", "middlename"]),
    dateOfBirth: normaliseDob(
      pick(bags, ["date_of_birth", "dateOfBirth", "dob", "birth_date"]),
    ),
    phone: pick(bags, ["phone", "phone_number", "phoneNumber", "mobile", "msisdn"]),
    gender: pick(bags, ["gender", "sex"]),
    raw: res,
  };
}
