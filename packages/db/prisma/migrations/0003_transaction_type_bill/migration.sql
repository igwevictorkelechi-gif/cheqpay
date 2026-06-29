-- Add the BILL transaction type (NGN bill payments via PSP).
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'BILL';
