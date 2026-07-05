-- Per-user opt-in to skip the 2FA step on crypto withdrawals.
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "instant_withdrawal" BOOLEAN NOT NULL DEFAULT false;
