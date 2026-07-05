-- Per-category notification opt-ins + registered Expo push tokens.
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "notification_prefs" JSONB;
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "push_tokens" TEXT[] NOT NULL DEFAULT '{}';
