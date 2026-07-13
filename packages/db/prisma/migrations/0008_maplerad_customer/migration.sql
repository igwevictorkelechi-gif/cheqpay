-- Maplerad customer id on the user: the foreign key every Maplerad resource
-- (stablecoin deposit addresses, cards) hangs off. Nullable — set at KYC
-- approval when the BVN is in hand.
ALTER TABLE "app_users" ADD COLUMN "maplerad_customer_id" TEXT;

CREATE UNIQUE INDEX "app_users_maplerad_customer_id_key"
  ON "app_users" ("maplerad_customer_id");
