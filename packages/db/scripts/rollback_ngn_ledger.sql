-- ============================================================================
-- Rollback for backfill_ngn_ledger.sql
-- ----------------------------------------------------------------------------
-- Best-effort revert. Only safe to run IMMEDIATELY after the backfill, before
-- the new ledger has taken any live writes (deposits/withdrawals/swaps).
-- If real activity has occurred, restore from the snapshot instead.
--
-- Removes the NGN balances and the app_users rows that were mirrored from the
-- legacy `users` table.
-- ============================================================================

BEGIN;

-- Remove backfilled NGN balances for users that exist in the legacy table.
DELETE FROM balances b
USING users u
WHERE b.user_id = u.id
  AND b.asset = 'NGN'::"Asset";

-- Remove app_users mirrored from legacy users that have no other ledger rows.
DELETE FROM app_users a
USING users u
WHERE a.id = u.id
  AND NOT EXISTS (SELECT 1 FROM balances b WHERE b.user_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.user_id = a.id);

COMMIT;
