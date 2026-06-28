import { getEnv } from "./env";

export interface AmlConfig {
  largeAmountKobo: bigint;
  reviewThresholdKobo: bigint;
  velocityCount: number;
  velocitySumKobo: bigint;
  sanctioned: Set<string>;
}

export interface AmlInput {
  ngnValueKobo: bigint;
  toAddress?: string | null;
  /** Count + NGN sum of the user's withdrawals in the current window. */
  recentCount: number;
  recentSumKobo: bigint;
}

export interface AmlAssessment {
  /** Hard block — do not process at all. */
  blocked: boolean;
  /** Reserve funds but hold for manual review before sending. */
  holdForReview: boolean;
  reasons: string[];
}

/** Build the AML config from env (whole-naira thresholds → kobo). */
export function amlConfigFromEnv(): AmlConfig {
  const env = getEnv();
  const sanctioned = new Set(
    (env.SANCTIONED_ADDRESSES ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean)
  );
  return {
    largeAmountKobo: BigInt(Math.round(env.AML_LARGE_AMOUNT_NGN * 100)),
    reviewThresholdKobo: BigInt(Math.round(env.AML_REVIEW_THRESHOLD_NGN * 100)),
    velocityCount: env.AML_VELOCITY_COUNT,
    velocitySumKobo: BigInt(Math.round(env.AML_VELOCITY_SUM_NGN * 100)),
    sanctioned,
  };
}

/**
 * Pure AML assessment for a withdrawal. Sanctioned destination → block.
 * Large amount / velocity / over the review threshold → hold for review.
 */
export function assessWithdrawal(input: AmlInput, cfg: AmlConfig): AmlAssessment {
  const reasons: string[] = [];
  let blocked = false;

  if (input.toAddress && cfg.sanctioned.has(input.toAddress.trim().toLowerCase())) {
    blocked = true;
    reasons.push("sanctioned_address");
  }
  if (input.ngnValueKobo >= cfg.largeAmountKobo) reasons.push("large_amount");
  if (input.recentCount >= cfg.velocityCount) reasons.push("velocity_count");
  if (input.recentSumKobo + input.ngnValueKobo >= cfg.velocitySumKobo) {
    reasons.push("velocity_sum");
  }
  if (input.ngnValueKobo >= cfg.reviewThresholdKobo) reasons.push("over_review_threshold");

  const holdForReview =
    !blocked &&
    reasons.some((r) =>
      ["large_amount", "velocity_count", "velocity_sum", "over_review_threshold"].includes(r)
    );

  return { blocked, holdForReview, reasons };
}
