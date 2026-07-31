-- Internal user-to-user transfers are recorded as a matched pair of rows so
-- each side sees its own direction in history. Additive; safe to re-run.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
