// apps/api/src/lib/maplerad/fx.ts
//
// Maplerad's foreign-exchange rail: quote a rate, then execute the exchange
// against the business's own balances. A quote is the first step and does not
// move money; POST /fx settles it and is what actually rebalances NGN↔USD.

import { mapleradRequest } from "./client";
import type { FxCurrency, FxExchangeResult, FxQuote } from "./types";

/**
 * Generate an FX quote.
 * POST /fx/quote
 *
 * `amount` is in the lowest denomination of the SOURCE currency (kobo for NGN,
 * cents for USD) — the same minor units we use internally. The returned quote
 * carries a `reference` that must be passed to exchangeFx to settle it.
 */
export async function quoteFx(input: {
  sourceCurrency: FxCurrency;
  targetCurrency: FxCurrency;
  amount: number;
}): Promise<FxQuote> {
  return mapleradRequest<FxQuote>("/fx/quote", {
    method: "POST",
    body: {
      source_currency: input.sourceCurrency,
      target_currency: input.targetCurrency,
      amount: input.amount,
    },
  });
}

/**
 * Execute a previously generated FX quote.
 * POST /fx
 *
 * This moves real money between the business's NGN and USD balances, so it is
 * the point of no return: call it only after the payer's funds are reserved.
 */
export async function exchangeFx(input: {
  quoteReference: string;
}): Promise<FxExchangeResult> {
  return mapleradRequest<FxExchangeResult>("/fx", {
    method: "POST",
    body: { quote_reference: input.quoteReference },
  });
}

/**
 * List processed FX transactions.
 * GET /fx
 *
 * The response shape is undocumented (the sandbox returns an empty envelope), so
 * this is typed loosely — callers should treat it as opaque history.
 */
export async function getFxHistory(): Promise<unknown> {
  return mapleradRequest<unknown>("/fx");
}
