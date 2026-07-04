import type { KycProvider, KycVerifyInput, KycVerifyResult } from "./types";

/**
 * Deterministic KYC provider for development/tests. Auto-verifies to tier 2 when
 * a well-formed 11-digit BVN and both names are present; otherwise leaves the
 * submission for manual admin review.
 */
export class MockKycProvider implements KycProvider {
  readonly name = "mock";

  async verify(input: KycVerifyInput): Promise<KycVerifyResult> {
    const hasNames =
      input.firstName.trim().length >= 2 && input.lastName.trim().length >= 2;
    const validBvn = !!input.bvn && /^\d{11}$/.test(input.bvn);

    if (validBvn && hasNames) {
      return {
        verified: true,
        tier: 2,
        reason: "BVN + name auto-verified (mock provider)",
        providerRef: `mock-kyc-${input.bvn}`,
      };
    }
    return {
      verified: false,
      tier: 1,
      reason: validBvn
        ? "Name incomplete — sent for manual review"
        : "No valid BVN provided — sent for manual review",
    };
  }
}
