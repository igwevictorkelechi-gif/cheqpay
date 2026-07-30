-- Cashback rewards are credited as their own ledger row so they never inflate
-- DEPOSIT analytics. Additive enum value; safe to re-run.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'CASHBACK';
