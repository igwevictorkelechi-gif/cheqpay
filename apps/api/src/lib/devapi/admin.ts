// apps/api/src/lib/devapi/admin.ts
//
// What the admin dashboard reads about developer accounts. Writes go through
// accounts.ts (review, suspend, freeze, limits) so the same rules hold.

import { prisma } from "@cheqpay/db";
import { toPublicId } from "@cheqpay/devapi";
import { ensureDevApiSchema } from "./ensureDevApi";
import { getAccount } from "./accounts";
import { getSubscription } from "./billing";
import { listApiKeys, keyIsActive } from "./keys";
import { listDevAudit } from "./audit";
import { findLedgerMismatches, liveTotals } from "./ledger";
import { effectiveLimits, getDevLimits } from "./limits";
import { dashboardAccountView, limitsView, subscriptionView, transactionObject, walletObject } from "./serialize";
import type { AccountStatus, DevTransactionRow, WalletRow } from "./types";

interface ListRow {
  id: string;
  business_name: string;
  legal_name: string | null;
  rc_number: string | null;
  status: AccountStatus;
  frozen: boolean;
  submitted_at: Date | null;
  created_at: Date;
  owner_email: string;
  plan_id: string | null;
  sub_status: string | null;
  current_period_end: Date | null;
  live_ngn: bigint | null;
  live_usd: bigint | null;
}

export async function adminListAccounts(status: AccountStatus | null) {
  await ensureDevApiSchema();
  const rows = await prisma.$queryRawUnsafe<ListRow[]>(
    `SELECT a.id, a.business_name, a.legal_name, a.rc_number, a.status, a.frozen, a.submitted_at, a.created_at,
            u.email AS owner_email, s.plan_id, s.status AS sub_status, s.current_period_end,
            (SELECT SUM(available_minor)::bigint FROM dev_wallets w WHERE w.account_id = a.id AND w.mode = 'live' AND w.currency = 'NGN') AS live_ngn,
            (SELECT SUM(available_minor)::bigint FROM dev_wallets w WHERE w.account_id = a.id AND w.mode = 'live' AND w.currency = 'USD') AS live_usd
       FROM dev_accounts a
       JOIN app_users u ON u.id = a.owner_user_id
       LEFT JOIN dev_subscriptions s ON s.account_id = a.id
      WHERE ($1::text IS NULL OR a.status = $1)
      ORDER BY CASE WHEN a.status = 'pending_review' THEN 0 ELSE 1 END, a.submitted_at DESC NULLS LAST, a.created_at DESC
      LIMIT 200`,
    status,
  );
  return rows.map((r) => ({
    id: r.id,
    public_id: toPublicId("account", r.id),
    business_name: r.business_name,
    legal_name: r.legal_name,
    rc_number: r.rc_number,
    status: r.status,
    frozen: r.frozen,
    submitted_at: r.submitted_at?.toISOString() ?? null,
    created_at: r.created_at.toISOString(),
    owner_email: r.owner_email,
    plan_id: r.plan_id,
    subscription_status: r.sub_status,
    current_period_end: r.current_period_end?.toISOString() ?? null,
    live_balance: { NGN: Number(r.live_ngn ?? 0n), USD: Number(r.live_usd ?? 0n) },
  }));
}

export async function adminAccountDetail(id: string) {
  const account = await getAccount(id);
  if (!account) return null;
  const [owner, sub, keys, audit, wallets, txs, limits, kycCounts, vaCounts, recentCustomers] = await Promise.all([
    prisma.user.findUnique({ where: { id: account.owner_user_id }, select: { email: true, kycTier: true, legalName: true, status: true } }),
    getSubscription(id),
    listApiKeys(id),
    listDevAudit(id, 50),
    prisma.$queryRawUnsafe<WalletRow[]>(`SELECT * FROM dev_wallets WHERE account_id = $1::uuid AND customer_id IS NULL ORDER BY mode, currency`, id),
    prisma.$queryRawUnsafe<DevTransactionRow[]>(
      `SELECT * FROM dev_transactions WHERE account_id = $1::uuid AND mode = 'live' ORDER BY created_at DESC LIMIT 25`,
      id,
    ),
    getDevLimits(),
    prisma.$queryRawUnsafe<{ mode: string; kyc_status: string; n: number }[]>(
      `SELECT mode, kyc_status, count(*)::int AS n FROM dev_customers WHERE account_id = $1::uuid GROUP BY mode, kyc_status`,
      id,
    ),
    prisma.$queryRawUnsafe<{ mode: string; n: number }[]>(
      `SELECT mode, count(*)::int AS n FROM dev_virtual_accounts WHERE account_id = $1::uuid AND status = 'active' GROUP BY mode`,
      id,
    ),
    // Names and status only: identity numbers stay encrypted and never reach the admin app.
    prisma.$queryRawUnsafe<
      { id: string; mode: string; first_name: string; last_name: string; bvn_last4: string; kyc_status: string; kyc_reason: string | null; created_at: Date }[]
    >(
      `SELECT id, mode, first_name, last_name, bvn_last4, kyc_status, kyc_reason, created_at FROM dev_customers
        WHERE account_id = $1::uuid ORDER BY (mode = 'live') DESC, created_at DESC LIMIT 25`,
      id,
    ),
  ]);
  const active = keys.filter((k) => keyIsActive(k));
  const tally = (mode: string) => ({
    pending: kycCounts.find((c) => c.mode === mode && c.kyc_status === "pending")?.n ?? 0,
    verified: kycCounts.find((c) => c.mode === mode && c.kyc_status === "verified")?.n ?? 0,
    rejected: kycCounts.find((c) => c.mode === mode && c.kyc_status === "rejected")?.n ?? 0,
    virtual_accounts: vaCounts.find((c) => c.mode === mode)?.n ?? 0,
  });
  return {
    id: account.id,
    account: dashboardAccountView(account),
    has_document: Boolean(account.cac_file_id),
    owner: owner
      ? { email: owner.email, kyc_tier: owner.kycTier, legal_name: owner.legalName, status: owner.status }
      : null,
    subscription: subscriptionView(sub),
    limits: limitsView(effectiveLimits(account, limits)),
    overrides: {
      daily_out_limit_ngn: account.daily_out_limit_ngn === null ? null : Number(account.daily_out_limit_ngn),
      daily_out_limit_usd: account.daily_out_limit_usd === null ? null : Number(account.daily_out_limit_usd),
      max_float_ngn: account.max_float_ngn === null ? null : Number(account.max_float_ngn),
      max_float_usd: account.max_float_usd === null ? null : Number(account.max_float_usd),
    },
    keys: { test: active.filter((k) => k.mode === "test").length, live: active.filter((k) => k.mode === "live").length },
    wallets: wallets.map(walletObject),
    recent_live_transactions: txs.map(transactionObject),
    audit: audit.map((a) => ({ actor: a.actor, action: a.action, ip: a.ip, details: a.details, created_at: a.created_at.toISOString() })),
    customers: {
      live: tally("live"),
      test: tally("test"),
      recent: recentCustomers.map((c) => ({
        id: toPublicId("customer", c.id),
        mode: c.mode,
        name: `${c.first_name} ${c.last_name}`,
        bvn_last4: c.bvn_last4,
        kyc_status: c.kyc_status,
        kyc_reason: c.kyc_reason,
        created_at: c.created_at.toISOString(),
      })),
    },
  };
}

/** Live developer money against what the ledger proves, for the treasury view. */
export async function adminReconciliation() {
  await ensureDevApiSchema();
  const [totals, mismatches] = await Promise.all([liveTotals(), findLedgerMismatches()]);
  return {
    live_totals: { NGN: Number(totals.NGN), USD: Number(totals.USD) },
    mismatches: mismatches.map((m) => ({
      wallet_id: m.wallet_id,
      account_id: m.account_id,
      mode: m.mode,
      currency: m.currency,
      balance: Number(m.available_minor),
      ledger_sum: Number(m.ledger_sum),
    })),
  };
}
