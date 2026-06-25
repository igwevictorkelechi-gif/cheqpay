import type { User, Wallet, VirtualAccount, Transaction } from "@cheqpay/shared";

/**
 * Demo account used for exploring the app without a live Supabase backend.
 * Seeded into the zustand stores by the "Continue as demo" action on login.
 */

export const DEMO_USER_ID = "demo-user";

const now = "2026-06-21T10:00:00.000Z";

export const demoUser: User = {
  id: DEMO_USER_ID,
  phone: "+2348100000000",
  email: "demo@cheqpay.app",
  full_name: "Victor Igwe",
  kyc_status: "approved",
  referral_code: "CHEQ-DEMO",
  created_at: now,
  updated_at: now,
};

export const demoWallet: Wallet = {
  id: "demo-wallet",
  user_id: DEMO_USER_ID,
  balance: 152340.5,
  ledger_balance: 152340.5,
  created_at: now,
  updated_at: now,
};

export const demoVirtualAccount: VirtualAccount = {
  id: "demo-va",
  user_id: DEMO_USER_ID,
  provider: "flutterwave",
  account_number: "7002349836",
  bank_name: "Wema Bank",
  bank_code: "035",
  reference: "cheqpay-demo",
  is_active: true,
  created_at: now,
  updated_at: now,
};

export const demoTransactions: Transaction[] = [
  {
    id: "tx1",
    user_id: DEMO_USER_ID,
    type: "debit",
    amount: 60521.3,
    reference: "TRF-2026-0455",
    narration: "Transfer to Victor Igwe",
    status: "completed",
    metadata: {},
    created_at: "2026-06-21T09:12:00.000Z",
  },
  {
    id: "tx2",
    user_id: DEMO_USER_ID,
    type: "credit",
    amount: 200000,
    reference: "DEP-2026-0454",
    narration: "Bank transfer deposit",
    status: "completed",
    metadata: {},
    created_at: "2026-06-20T16:40:00.000Z",
  },
  {
    id: "tx3",
    user_id: DEMO_USER_ID,
    type: "airtime",
    amount: 1000,
    reference: "AIR-2026-0453",
    narration: "MTN airtime top-up",
    status: "completed",
    metadata: {},
    created_at: "2026-06-19T08:05:00.000Z",
  },
  {
    id: "tx4",
    user_id: DEMO_USER_ID,
    type: "withdrawal",
    amount: 25000,
    reference: "WTH-2026-0452",
    narration: "Withdrawal to GTBank",
    status: "pending",
    metadata: {},
    created_at: "2026-06-18T14:22:00.000Z",
  },
];

export function isDemoUser(user: { id?: string } | null | undefined): boolean {
  return user?.id === DEMO_USER_ID;
}
