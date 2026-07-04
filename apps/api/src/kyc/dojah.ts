import type { KycProvider, KycVerifyInput, KycVerifyResult } from "./types";

/**
 * Dojah BVN verification. Looks up the BVN and confirms the returned first/last
 * name matches what the user submitted. On a match → auto-verify to tier 2;
 * otherwise the submission falls through to manual admin review.
 *
 * NOTE: shape-correct per Dojah's KYC (BVN) API but NOT exercised live in this
 * build — validate against current Dojah docs and your enabled products before
 * relying on it in production.
 */
export class DojahKycProvider implements KycProvider {
  readonly name = "dojah";

  constructor(
    private readonly appId: string,
    private readonly apiKey: string,
    private readonly base: string
  ) {}

  async verify(input: KycVerifyInput): Promise<KycVerifyResult> {
    if (!input.bvn || !/^\d{11}$/.test(input.bvn)) {
      return { verified: false, tier: 1, reason: "No valid BVN provided" };
    }

    let res: Response;
    try {
      res = await fetch(
        `${this.base}/api/v1/kyc/bvn/full?bvn=${encodeURIComponent(input.bvn)}`,
        { headers: { AppId: this.appId, Authorization: this.apiKey } }
      );
    } catch {
      return { verified: false, tier: 1, reason: "Could not reach the verification service" };
    }

    const json = (await res.json().catch(() => ({}))) as {
      entity?: {
        bvn?: string;
        first_name?: string;
        last_name?: string;
        date_of_birth?: string;
      };
    };
    if (!res.ok || !json.entity?.bvn) {
      return { verified: false, tier: 1, reason: "BVN not found or lookup failed" };
    }

    const nameMatches =
      norm(json.entity.first_name) === norm(input.firstName) &&
      norm(json.entity.last_name) === norm(input.lastName);

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
      reason: "BVN + name verified via Dojah",
      providerRef: `dojah-bvn-${input.bvn}`,
    };
  }
}

/** Lowercase, trim, collapse whitespace for a lenient name comparison. */
function norm(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
