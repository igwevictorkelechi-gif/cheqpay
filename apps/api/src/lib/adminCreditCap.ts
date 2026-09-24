// apps/api/src/lib/adminCreditCap.ts
//
// A ceiling on money admins can create.
//
// Two dashboard actions put balance into an account on an admin's say-so rather
// than because money arrived: Adjust Balance (a credit from nothing) and Credit
// Crypto (a deposit an admin asserts happened). Both are needed — fixing a
// failed deposit, compensating a customer — and both were used in the 22 Sep
// incident, which credited 10,000 USDT and 1 BTC in under twenty seconds.
//
// The cap is a rolling 24 hours per asset, counted across ALL admins, and it is
// read from the deployment's environment. That last part is the point: a
// dashboard session, however it was obtained, cannot raise its own ceiling.
// Raising it means changing ADMIN_CREDIT_DAILY_LIMITS in Vercel and redeploying.

import { Asset, prisma } from "@cheqpay/db";
import { toMinorUnits } from "./money";

/** Whole-unit defaults. Low on purpose; raise per business need via env. */
const DEFAULTS: Record<string, string> = {
  NGN: "1000000",
  USD: "1000",
  USDT: "1000",
  USDC: "1000",
  BTC: "0.02",
};

/** Parse "NGN=1000000,USDT=1000" into per-asset whole-unit limits. */
export function parseLimits(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULTS };
  for (const part of (raw ?? "").split(",")) {
    const [k, v] = part.split("=").map((x) => x?.trim());
    if (k && v && /^\d+(\.\d+)?$/.test(v) && k.toUpperCase() in DEFAULTS) out[k.toUpperCase()] = v;
  }
  return out;
}

export interface CreditHeadroom {
  limitMinor: bigint;
  usedMinor: bigint;
  remainingMinor: bigint;
}

/** How much more of `asset` admins may create in the current 24-hour window. */
export async function adminCreditHeadroom(asset: Asset): Promise<CreditHeadroom> {
  const limits = parseLimits(process.env.ADMIN_CREDIT_DAILY_LIMITS);
  const limitMinor = toMinorUnits(limits[asset] ?? "0", asset);

  const rows = await prisma.$queryRawUnsafe<{ used: string | null }[]>(
    `SELECT COALESCE(SUM(amount), 0)::text AS used
       FROM ledger_transactions
      WHERE asset::text = $1
        AND created_at > now() - interval '24 hours'
        AND status::text <> 'REVERSED'
        AND (
          (metadata->>'kind' = 'admin_adjustment' AND metadata->>'direction' = 'credit')
          OR metadata->>'source' = 'manual_admin_credit'
        )`,
    asset,
  );
  const usedMinor = BigInt(rows[0]?.used ?? "0");
  const remainingMinor = limitMinor > usedMinor ? limitMinor - usedMinor : 0n;
  return { limitMinor, usedMinor, remainingMinor };
}
