/** Human labels + descriptions for the KYC account levels. */
export interface TierInfo {
  label: string;
  short: string;
  description: string;
  verified: boolean;
}

export function tierInfo(tier: number): TierInfo {
  switch (tier) {
    case 3:
      return {
        label: "Tier 3 · Premium",
        short: "Tier 3",
        description: "Highest limits and full access.",
        verified: true,
      };
    case 2:
      return {
        label: "Tier 2 · Verified",
        short: "Tier 2",
        description: "Identity verified. Higher limits and crypto withdrawals unlocked.",
        verified: true,
      };
    case 1:
      return {
        label: "Tier 1 · Basic",
        short: "Tier 1",
        description: "Basic access with modest limits. Verify to raise them.",
        verified: false,
      };
    default:
      return {
        label: "Tier 0 · Unverified",
        short: "Unverified",
        description: "Verify your identity to start transacting fully.",
        verified: false,
      };
  }
}
