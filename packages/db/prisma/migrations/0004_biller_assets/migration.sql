-- Admin-uploaded brand logos for bill billers.
CREATE TABLE IF NOT EXISTS "biller_assets" (
  "biller_id" TEXT NOT NULL,
  "logo" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "biller_assets_pkey" PRIMARY KEY ("biller_id")
);
