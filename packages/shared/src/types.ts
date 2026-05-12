// User Types
export interface User {
  id: string;
  phone: string;
  email: string;
  full_name: string;
  kyc_status: 'pending' | 'approved' | 'rejected';
  referral_code: string;
  created_at: string;
  updated_at: string;
}

// Wallet Types
export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  ledger_balance: number;
  created_at: string;
  updated_at: string;
}

// Virtual Account Types
export interface VirtualAccount {
  id: string;
  user_id: string;
  provider: 'paystack' | 'flutterwave';
  account_number: string;
  bank_name: string;
  bank_code: string;
  reference: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Transaction Types
export type TransactionType = 'credit' | 'debit' | 'transfer' | 'withdrawal' | 'airtime' | 'bills';

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  reference: string;
  narration: string;
  status: 'pending' | 'completed' | 'failed';
  metadata: Record<string, any>;
  created_at: string;
}

// Payment Config
export interface PaymentConfig {
  id: string;
  provider: 'paystack' | 'flutterwave';
  public_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Auth Types
export interface AuthResponse {
  success: boolean;
  message: string;
  data?: {
    user: User;
    wallet: Wallet;
  };
}

export interface OTPData {
  phone: string;
  otp_code?: string;
  session_id?: string;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

// Form Types
export interface SendMoneyPayload {
  recipient_phone: string;
  amount: number;
  narration?: string;
}

export interface WithdrawPayload {
  bank_account_number: string;
  bank_code: string;
  amount: number;
  narration?: string;
}

export interface KYCPayload {
  bvn?: string;
  nin?: string;
  id_document?: string;
  id_type?: string;
}
