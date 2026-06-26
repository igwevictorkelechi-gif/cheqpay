/**
 * KYC tiers and the limits they unlock. All monetary limits are in NGN minor
 * units (kobo) as BigInt — no floats. Higher tiers require ID/BVN and lift
 * ceilings. These are enforced server-side before any money moves.
 */
export interface TierLimits {
  /** Max value of a single transaction (kobo). */
  singleTxKobo: bigint;
  /** Rolling 24h deposit ceiling (kobo). */
  dailyDepositKobo: bigint;
  /** Rolling 24h withdrawal ceiling (kobo). */
  dailyWithdrawalKobo: bigint;
  /** Whether crypto withdrawals are permitted at this tier. */
  cryptoWithdrawalEnabled: boolean;
}

const NGN = (naira: number): bigint => BigInt(naira) * 100n;

export const KYC_TIER_LIMITS: Record<number, TierLimits> = {
  // Tier 0 — unverified (email/phone not yet confirmed). View-only-ish.
  0: {
    singleTxKobo: 0n,
    dailyDepositKobo: 0n,
    dailyWithdrawalKobo: 0n,
    cryptoWithdrawalEnabled: false,
  },
  // Tier 1 — email + phone OTP verified, minimal info. Modest limits.
  1: {
    singleTxKobo: NGN(50_000),
    dailyDepositKobo: NGN(200_000),
    dailyWithdrawalKobo: NGN(100_000),
    cryptoWithdrawalEnabled: false,
  },
  // Tier 2 — ID/BVN verified.
  2: {
    singleTxKobo: NGN(1_000_000),
    dailyDepositKobo: NGN(5_000_000),
    dailyWithdrawalKobo: NGN(2_000_000),
    cryptoWithdrawalEnabled: true,
  },
  // Tier 3 — enhanced due diligence.
  3: {
    singleTxKobo: NGN(20_000_000),
    dailyDepositKobo: NGN(100_000_000),
    dailyWithdrawalKobo: NGN(50_000_000),
    cryptoWithdrawalEnabled: true,
  },
};

export const MAX_TIER = 3;

export function getTierLimits(tier: number): TierLimits {
  return KYC_TIER_LIMITS[tier] ?? KYC_TIER_LIMITS[0];
}

export function isWithinSingleTxLimit(tier: number, amountKobo: bigint): boolean {
  return amountKobo > 0n && amountKobo <= getTierLimits(tier).singleTxKobo;
}

export function remainingDailyDeposit(
  tier: number,
  usedTodayKobo: bigint
): bigint {
  const cap = getTierLimits(tier).dailyDepositKobo;
  const left = cap - usedTodayKobo;
  return left > 0n ? left : 0n;
}

export function remainingDailyWithdrawal(
  tier: number,
  usedTodayKobo: bigint
): bigint {
  const cap = getTierLimits(tier).dailyWithdrawalKobo;
  const left = cap - usedTodayKobo;
  return left > 0n ? left : 0n;
}
