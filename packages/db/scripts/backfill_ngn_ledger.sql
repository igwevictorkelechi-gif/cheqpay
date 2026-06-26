-- ============================================================================
-- Backfill: legacy NGN wallets -> unified minor-unit ledger
-- ----------------------------------------------------------------------------
-- Moves the existing Supabase NGN balances (DECIMAL naira) into the new Prisma
-- ledger as integer kobo. Idempotent and transactional.
--
-- PREREQUISITES:
--   1. Run the Prisma migration first so the new tables/enums exist:
--        cd packages/db && bunx prisma migrate deploy
--   2. TAKE A DATABASE SNAPSHOT before running this (Supabase: Database ->
--      Backups). The rollback script is best-effort; a snapshot is the real
--      safety net.
--
-- ASSUMPTION (verified against the existing schema): legacy `users.id` is the
-- Supabase auth uid, which is also the id we store in `app_users`. So ids line
-- up 1:1 and we can migrate by id.
-- ============================================================================

BEGIN;

-- 1) Mirror legacy users into app_users (id preserved).
INSERT INTO app_users (id, email, phone, kyc_tier, status, created_at, updated_at)
SELECT
  u.id,
  u.email,
  u.phone,
  CASE WHEN u.kyc_status = 'approved' THEN 1 ELSE 0 END,
  'ACTIVE'::"UserStatus",
  u.created_at,
  NOW()
FROM users u
ON CONFLICT (id) DO NOTHING;

-- 2) Backfill NGN balances as kobo (round to nearest kobo; no floats persisted).
INSERT INTO balances (id, user_id, asset, available, locked, updated_at)
SELECT
  gen_random_uuid(),
  w.user_id,
  'NGN'::"Asset",
  (round(w.balance * 100))::bigint,
  0,
  NOW()
FROM wallets w
WHERE EXISTS (SELECT 1 FROM app_users a WHERE a.id = w.user_id)
ON CONFLICT (user_id, asset)
  DO UPDATE SET available = EXCLUDED.available, updated_at = NOW();

-- 3) Verification (review before COMMIT — totals must match).
--    Legacy total naira vs new ledger total kobo/100.
DO $$
DECLARE
  legacy_total numeric;
  new_total numeric;
BEGIN
  SELECT COALESCE(SUM(balance), 0) INTO legacy_total FROM wallets;
  SELECT COALESCE(SUM(available), 0) / 100.0 INTO new_total
    FROM balances WHERE asset = 'NGN'::"Asset";
  RAISE NOTICE 'Legacy NGN total: %, New ledger NGN total: %', legacy_total, new_total;
  IF round(legacy_total, 2) <> round(new_total, 2) THEN
    RAISE EXCEPTION 'NGN totals do not match (legacy % vs new %) — rolling back', legacy_total, new_total;
  END IF;
END $$;

COMMIT;
