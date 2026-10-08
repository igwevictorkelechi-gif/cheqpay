// apps/api/src/lib/devapi/serialize.ts
//
// The API's response objects, built field by field. Nothing here spreads a
// database row: a column added later (an encrypted BVN, an internal note) can
// only reach a developer if someone adds it to one of these on purpose.

import { toPublicId } from "@cheqpay/devapi";
import type { DevPlan } from "./plans";
import type { EffectiveLimits } from "./limits";
import type { AccountRow, DevTransactionRow, KeyRow, LedgerEntryRow, Mode, SubscriptionRow, WalletRow } from "./types";

/** Minor units as a JSON number. Every amount we hold is far below 2^53. */
export function n(v: bigint | number | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v);
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const pid = (kind: Parameters<typeof toPublicId>[0], id: string | null | undefined) => (id ? toPublicId(kind, id) : null);

export function accountObject(a: AccountRow, mode: Mode, plan: DevPlan, liveEnabled: boolean, limits: EffectiveLimits) {
  return {
    object: "account",
    id: toPublicId("account", a.id),
    business_name: a.business_name,
    status: a.status,
    mode,
    livemode: mode === "live",
    live_enabled: liveEnabled,
    plan: { id: plan.id, name: plan.name, rate_limit_per_minute: plan.rpm },
    limits:
      mode === "live"
        ? {
            daily_outflow: { NGN: n(limits.dailyOut.NGN), USD: n(limits.dailyOut.USD) },
            max_balance: { NGN: n(limits.maxFloat.NGN), USD: n(limits.maxFloat.USD) },
            max_single_payment: { NGN: n(limits.perTxnMax.NGN), USD: n(limits.perTxnMax.USD) },
          }
        : null,
    created_at: iso(a.created_at),
  };
}

export function walletObject(w: WalletRow) {
  return {
    object: "wallet",
    id: toPublicId("wallet", w.id),
    type: w.customer_id ? "customer" : "main",
    customer_id: pid("customer", w.customer_id),
    currency: w.currency,
    available_balance: n(w.available_minor),
    status: w.status,
    livemode: w.mode === "live",
    created_at: iso(w.created_at),
  };
}

/** Per kind, the `details` fields a developer may see. Anything else stays internal. */
const DETAIL_FIELDS: Partial<Record<DevTransactionRow["kind"], readonly string[]>> = {
  wallet_move: ["direction"],
  subscription: ["plan_id", "from_plan_id", "prorated", "period_start", "period_end", "renewal"],
  deposit: ["virtual_account_id", "payer"],
  conversion: ["quote_id", "to_currency", "converted_amount", "fx_fee", "rate"],
};

export function transactionObject(t: DevTransactionRow) {
  const allowed = DETAIL_FIELDS[t.kind] ?? [];
  const details: Record<string, unknown> = {};
  for (const k of allowed) if (k in (t.details ?? {})) details[k] = (t.details as Record<string, unknown>)[k];
  return {
    object: "transaction",
    id: toPublicId("transaction", t.id),
    kind: t.kind,
    status: t.status,
    currency: t.currency,
    amount: n(t.amount_minor),
    fee: n(t.fee_minor),
    wallet_id: pid("wallet", t.wallet_id),
    counterparty_wallet_id: pid("wallet", t.counterparty_wallet_id),
    customer_id: pid("customer", t.customer_id),
    reference: t.reference,
    description: t.description,
    details,
    metadata: t.metadata ?? {},
    failure: t.failure_code ? { code: t.failure_code, message: t.failure_message } : null,
    livemode: t.mode === "live",
    created_at: iso(t.created_at),
    completed_at: iso(t.completed_at),
  };
}

export function entryObject(e: LedgerEntryRow) {
  return {
    object: "wallet_entry",
    id: String(e.id),
    transaction_id: toPublicId("transaction", e.transaction_id),
    kind: e.kind,
    amount: n(e.amount_minor),
    balance_after: n(e.balance_after),
    created_at: iso(e.created_at),
  };
}

/** Dashboard view of a key: never the secret or its hash. */
export function keyView(k: KeyRow, now: Date = new Date()) {
  const state = k.revoked_at ? "revoked" : k.expires_at && k.expires_at <= now ? "expired" : "active";
  return {
    id: toPublicId("key", k.id),
    label: k.label,
    mode: k.mode,
    preview: `cp_${k.mode}_sk_…${k.last4}`,
    scopes: k.scopes,
    allowed_ips: k.allowed_ips,
    state,
    expires_at: iso(k.expires_at),
    revoked_at: iso(k.revoked_at),
    revoked_reason: k.revoked_reason,
    last_used_at: iso(k.last_used_at),
    last_used_ip: k.last_used_ip,
    created_at: iso(k.created_at),
  };
}

export function subscriptionView(s: SubscriptionRow | null) {
  if (!s) return null;
  return {
    plan_id: s.plan_id,
    status: s.status,
    current_period_start: iso(s.current_period_start),
    current_period_end: iso(s.current_period_end),
    cancel_at_period_end: s.cancel_at_period_end,
    next_plan_id: s.next_plan_id,
    past_due_since: iso(s.past_due_since),
  };
}

export function planView(p: DevPlan) {
  return {
    id: p.id,
    name: p.name,
    price: p.priceMinor,
    currency: "NGN",
    live: p.live,
    rate_limit_per_minute: p.rpm,
    bill_fee: { bps: p.billFeeBps, cap: p.billFeeCapMinor },
    deposit_fee: { bps: p.depositFeeBps, cap: p.depositFeeCapMinor },
    card_issue_fee_usd_cents: p.cardIssueFeeCents,
    card_funding_fee_bps: p.cardFundFeeBps,
    max_customers: p.maxCustomers,
    max_virtual_accounts: p.maxVirtualAccounts,
    max_active_cards: p.maxActiveCards,
    webhook_endpoints: p.webhookEndpoints,
  };
}

/** The owner's own view of their account in the dashboard. */
export function dashboardAccountView(a: AccountRow) {
  return {
    id: toPublicId("account", a.id),
    business_name: a.business_name,
    status: a.status,
    review_note: a.status === "rejected" || a.status === "approved" ? a.review_note : null,
    submitted_at: iso(a.submitted_at),
    reviewed_at: iso(a.reviewed_at),
    live_since: iso(a.live_since),
    application: a.submitted_at
      ? {
          legal_name: a.legal_name,
          rc_number: a.rc_number,
          business_type: a.business_type,
          website: a.website,
          use_case: a.use_case,
          expected_monthly_volume: a.expected_monthly_volume,
          contact_phone: a.contact_phone,
          address: a.address,
        }
      : null,
    frozen: a.frozen,
    frozen_by: a.frozen_by,
    frozen_reason: a.frozen_reason,
    suspended_reason: a.status === "suspended" ? a.suspended_reason : null,
    require_ip_allowlist: a.require_ip_allowlist,
    created_at: iso(a.created_at),
  };
}

export function limitsView(l: EffectiveLimits) {
  return {
    new_account: l.newAccount,
    daily_outflow: { NGN: n(l.dailyOut.NGN), USD: n(l.dailyOut.USD) },
    max_balance: { NGN: n(l.maxFloat.NGN), USD: n(l.maxFloat.USD) },
    max_single_payment: { NGN: n(l.perTxnMax.NGN), USD: n(l.perTxnMax.USD) },
  };
}
