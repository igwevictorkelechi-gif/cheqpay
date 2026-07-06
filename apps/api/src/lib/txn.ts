import { Asset } from "@cheqpay/db";
import type { Transaction } from "@cheqpay/db";
import { fromMinorUnits } from "./money";

/**
 * Shape a ledger Transaction row into the client-facing payload: formatted
 * amounts plus the from/to legs (swaps/converts) and bill details from metadata,
 * so clients render without re-deriving minor units.
 */
export function serializeTransaction(t: Transaction) {
  const meta = (t.metadata ?? {}) as {
    fromAsset?: string;
    toAsset?: string;
    amountIn?: string;
    amountOut?: string;
    kind?: string;
    service?: string;
    billerName?: string;
    planName?: string | null;
    customer?: string;
    token?: string | null;
    toAddress?: string;
    rate?: string;
  };
  const fromAsset = meta.fromAsset as Asset | undefined;
  const toAsset = meta.toAsset as Asset | undefined;
  return {
    id: t.id,
    type: t.type,
    asset: t.asset,
    network: t.network,
    amount: t.amount.toString(),
    amountFormatted: fromMinorUnits(t.amount, t.asset),
    fee: t.fee.toString(),
    feeFormatted: fromMinorUnits(t.fee, t.asset),
    status: t.status,
    txHash: t.txHash,
    createdAt: t.createdAt.toISOString(),
    fromAsset: fromAsset ?? null,
    toAsset: toAsset ?? null,
    fromFormatted:
      fromAsset && meta.amountIn ? fromMinorUnits(BigInt(meta.amountIn), fromAsset) : null,
    toFormatted:
      toAsset && meta.amountOut ? fromMinorUnits(BigInt(meta.amountOut), toAsset) : null,
    rate: meta.rate ?? null,
    toAddress: meta.toAddress ?? null,
    service: meta.service ?? null,
    billerName: meta.billerName ?? null,
    planName: meta.planName ?? null,
    customer: meta.customer ?? null,
    token: meta.token ?? null,
  };
}
