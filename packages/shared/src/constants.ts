// Nigerian Banks with codes
export const NIGERIAN_BANKS = [
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' },
  { name: 'GTBank', code: '058' },
  { name: 'Access Bank', code: '044' },
  { name: 'First Bank', code: '011' },
  { name: 'UBA', code: '033' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'Ecobank', code: '050' },
  { name: 'FCMB', code: '011' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'Stanbic IBTC', code: '221' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'Unity Bank', code: '215' },
  { name: 'Keystone Bank', code: '082' },
];

// API Endpoints
export const API_ENDPOINTS = {
  AUTH: {
    SEND_OTP: '/auth/send-otp',
    VERIFY_OTP: '/auth/verify-otp',
    REGISTER: '/auth/register',
    LOGIN: '/auth/login',
  },
  WALLET: {
    GET_BALANCE: '/wallet/balance',
    GET_TRANSACTIONS: '/wallet/transactions',
    TRANSFER: '/wallet/transfer',
    WITHDRAW: '/wallet/withdraw',
  },
  VIRTUAL_ACCOUNT: {
    GET_ACCOUNT: '/virtual-account',
    CREATE_ACCOUNT: '/virtual-account/create',
  },
  USER: {
    GET_PROFILE: '/user/profile',
    UPDATE_PROFILE: '/user/profile',
    KYC_SUBMIT: '/user/kyc',
  },
};

// Transaction Types with display names
export const TRANSACTION_TYPES = {
  credit: { label: 'Fund Wallet', color: '#10B981' },
  debit: { label: 'Withdrawal', color: '#EF4444' },
  transfer: { label: 'Transfer', color: '#3B82F6' },
  withdrawal: { label: 'Withdrawal', color: '#EF4444' },
  airtime: { label: 'Airtime', color: '#F59E0B' },
  bills: { label: 'Bills', color: '#8B5CF6' },
};

// Transaction Status
export const TRANSACTION_STATUS = {
  pending: { label: 'Pending', color: '#FCD34D' },
  completed: { label: 'Completed', color: '#10B981' },
  failed: { label: 'Failed', color: '#EF4444' },
};

// KYC Status
export const KYC_STATUS = {
  pending: 'Pending Verification',
  approved: 'Verified',
  rejected: 'Verification Failed',
};

// Limits
export const LIMITS = {
  MIN_TRANSFER: 50,
  MAX_TRANSFER: 5000000,
  MIN_WITHDRAWAL: 100,
  MAX_WITHDRAWAL: 5000000,
  DAILY_LIMIT: 50000000,
};

// Paystack banks for virtual accounts
export const PAYSTACK_BANKS = [
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' },
  { name: 'GTBank', code: '058' },
  { name: 'Access Bank', code: '044' },
];
