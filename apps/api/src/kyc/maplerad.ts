// apps/api/src/kyc/maplerad.ts
//
// Verify identity against Maplerad's BVN registry lookup.
//
// POST /identity/bvn returns what the registry holds for a number — names, date
// of birth, phone. Confirming the returned name matches what the user typed is
// the check. It creates nothing and moves no money, so it is safe to run on
// every submission.
//
// This replaced an earlier version that verified by *enrolling* the user, which
// was heavier than the job needs: enrollment requires a date of birth, a phone
// and a full street address before it will tell you anything, so a user with a
// perfectly valid BVN could not be verified until they had supplied four more
// fields. A lookup needs the BVN alone. Enrollment still happens — separately,
// after approval, in the KYC route — which is where it belongs.
//
// ⚠️ Maplerad enforces an IP whitelist and Vercel has no fixed egress IP, so
// without MAPLERAD_BASE_URL pointing at the egress proxy every call here
// returns "Access Denied" and nobody can verify. Do not set
// KYC_PROVIDER=maplerad until /api/admin/provider-check passes.

import { verifyBvn } from "@/lib/maplerad/identity";
import type { KycProvider, KycVerifyInput, KycVerifyResult } from "./types";

export class MapleradKycProvider implements KycProvider {
  readonly name = "maplerad";

  async verify(input: KycVerifyInput): Promise<KycVerifyResult> {
    if (!input.bvn || !/^\d{11}$/.test(input.bvn)) {
      return { verified: false, tier: 1, reason: "No valid BVN provided" };
    }

    let found;
    try {
      found = await verifyBvn(input.bvn);
    } catch (err) {
      // Covers a refused lookup and an unreachable provider alike. Either way
      // the submission falls through to manual review rather than being
      // reported to the user as a rejected identity.
      return {
        verified: false,
        tier: 1,
        reason: `BVN lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!found?.first_name || !found?.last_name) {
      return { verified: false, tier: 1, reason: "BVN not found" };
    }

    // Names only, matching the Dojah provider. The registry's date of birth is
    // deliberately not used as a gate: placeholder dates are common in the BVN
    // data, and rejecting on one would turn a registry defect into a user who
    // cannot open an account.
    const nameMatches =
      norm(found.first_name) === norm(input.firstName) &&
      norm(found.last_name) === norm(input.lastName);

    if (!nameMatches) {
      return {
        verified: false,
        tier: 1,
        reason: "BVN name did not match the details provided",
      };
    }

    return {
      verified: true,
      tier: 2,
      reason: "BVN + name verified via Maplerad",
      // The BVN itself is never put in a provider reference — it is the
      // identifier we encrypt everywhere else, and this string reaches the
      // audit log in clear.
      providerRef: `maplerad-bvn-${input.bvn.slice(-4)}`,
    };
  }
}

/** Lowercase, trim, collapse whitespace for a lenient name comparison. */
function norm(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
