import { User, Wallet, VirtualAccount } from '@cheqpay/shared';

/**
 * Demo account for exploring the app without a live Supabase backend.
 * Seeded into the stores by the "Continue as demo" action on login.
 */

export const DEMO_USER_ID = 'demo-user';

const now = '2026-06-21T10:00:00.000Z';

export const demoUser: User = {
  id: DEMO_USER_ID,
  phone: '+2348100000000',
  email: 'demo@cheqpay.app',
  full_name: 'Victor Igwe',
  kyc_status: 'approved',
  referral_code: 'CHEQ-DEMO',
  created_at: now,
  updated_at: now,
};

export const demoWallet: Wallet = {
  id: 'demo-wallet',
  user_id: DEMO_USER_ID,
  balance: 152340.5,
  ledger_balance: 152340.5,
  created_at: now,
  updated_at: now,
};

export const demoVirtualAccount: VirtualAccount = {
  id: 'demo-va',
  user_id: DEMO_USER_ID,
  provider: 'flutterwave',
  account_number: '7002349836',
  bank_name: 'Wema Bank',
  bank_code: '035',
  reference: 'cheqpay-demo',
  is_active: true,
  created_at: now,
  updated_at: now,
};
