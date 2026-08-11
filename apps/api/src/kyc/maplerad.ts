// apps/api/src/kyc/maplerad.ts
//
// Verify identity by enrolling the user as a Maplerad customer, rather than
// asking a separate identity bureau and hoping the two agree.
//
// Why this exists. With a separate provider there are two answers to "is this
// user verified": our KycRecord, written from the bureau's verdict, and the
// Maplerad customer tier, which is what actually governs whether Maplerad will
// open an account or issue a stablecoin address. They diverge in exactly one
// direction and it is the worst one — the bureau approves on BVN + name, the
// app says "verified", and then enrollment quietly fails for want of a phone or
// an address, so the user is told they are verified and still cannot be given
// an account number. Enrolling as the verification step collapses the two into
// one answer.
//
// It does NOT ask the user for less. Maplerad tier 1 needs BVN, date of birth,
// phone and address where a bureau needs BVN and a name. What it removes is the
// false success in between, and one provider to hold credentials for.
//
// ⚠️ This provider is only usable where Maplerad itself is reachable. Maplerad
// enforces an IP whitelist and Vercel has no fixed egress IP, so without
// MAPLERAD_BASE_URL pointing at the egress proxy every enrollment returns
// "Access Denied" — and with this selected that means nobody can verify at all,
// which is worse than the split-brain it fixes. Do not set KYC_PROVIDER=maplerad
// until /api/admin/provider-check passes.

import { ensureMapleradCustomer } from "@/lib/mapleradCustomer";
import type { KycProvider, KycVerifyInput, KycVerifyResult } from "./types";

/** Maplerad tier 1 is what unlocks accounts and stablecoin addresses. */
const TIER = 1;

export class MapleradKycProvider implements KycProvider {
  readonly name = "maplerad";

  async verify(input: KycVerifyInput): Promise<KycVerifyResult> {
    if (!input.userId || !input.email) {
      // A programming error rather than a failed check: the route did not pass
      // through what this provider needs. Say so plainly instead of reporting
      // the user as unverified, which would look like their BVN was rejected.
      return {
        verified: false,
        tier: 0,
        reason:
          "KYC_PROVIDER=maplerad needs the user id and email; the caller did not supply them.",
      };
    }

    // ensureMapleradCustomer is idempotent and already swallows provider
    // errors, returning null. It is the same call the KYC route makes after
    // approval, so selecting this provider does not enroll twice — the second
    // call finds the persisted id and returns it.
    const customerId = await ensureMapleradCustomer(input.userId, input.email, {
      firstName: input.firstName,
      lastName: input.lastName,
      bvn: input.bvn,
      dateOfBirth: input.dateOfBirth,
      phone: input.phone,
      address: input.address,
    });

    if (!customerId) {
      return {
        verified: false,
        tier: 0,
        // Deliberately not "your BVN was rejected": the enrollment can also be
        // skipped for incomplete data or fail on the provider's side, and the
        // server log distinguishes them. Sending it for review is the safe
        // reading of an ambiguous outcome.
        reason:
          "Maplerad did not confirm this identity. Sent for review — check the server log for whether data was missing or the provider refused.",
      };
    }

    return {
      verified: true,
      tier: TIER,
      reason: "Enrolled as a Maplerad customer; identity confirmed against the BVN.",
      providerRef: customerId,
    };
  }
}
