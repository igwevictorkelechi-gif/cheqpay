-- Add the CONVERT transaction type (crypto -> crypto swaps).
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'CONVERT';
