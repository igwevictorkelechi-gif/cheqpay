-- Editable profile fields: username (unique, nulls allowed), DOB, next of kin.
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "date_of_birth" DATE;
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "next_of_kin" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "app_users_username_key" ON "app_users" ("username");
