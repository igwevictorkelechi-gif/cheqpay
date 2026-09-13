// apps/api/src/lib/maplerad/airtimeHistory.ts
//
// Reading airtime purchases back from Maplerad.
//
// Bills settle on a bill.* webhook. A webhook that never arrives — dropped,
// delivered while the handler was broken, or fired before we subscribed —
// leaves a purchase stuck PROCESSING with the customer debited and no way to
// tell whether the airtime actually landed. This endpoint is the record that
// answers it: GET /bills/airtime returns the business's airtime purchases.
//
// Note the asymmetry this supports, which callers must preserve: an entry here
// PROVES the purchase happened, but its absence proves nothing (the list may be
// recent-only or paginated). So presence settles a bill as successful, and
// absence leaves it alone rather than refunding a purchase that may have gone
// through.

import { mapleradRequest } from "./client";

/** One row of GET /bills/airtime. Amounts are integer minor units (kobo). */
export interface AirtimePurchase {
  /** Maplerad's transaction id — what we store as the ledger row's externalRef. */
  id: string;
  amount: number;
  phone_number?: string;
  network?: string;
  /** What the business wallet was actually debited, after commission. */
  debit_amount?: number;
  commission_earned?: number;
  created_at?: string;
  [key: string]: unknown;
}

/**
 * Every airtime purchase Maplerad holds for the business. Read-only.
 *
 * There is no status field on these rows: the endpoint is a purchase history,
 * so being listed is itself the confirmation.
 */
export async function getAirtimeHistory(): Promise<AirtimePurchase[]> {
  const data = await mapleradRequest<AirtimePurchase[] | null>("/bills/airtime");
  return Array.isArray(data) ? data : [];
}
