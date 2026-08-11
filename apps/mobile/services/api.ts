import { supabase } from './supabase';

// Base URL of the custodial backend (apps/api).
const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'https://cheqpay-admin453.vercel.app';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(await authHeader()),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || res.statusText, data);
  }
  return data as T;
}

function idemKey(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
}

// ---- Types ----
export type AssetSymbol = 'BTC' | 'USDT' | 'USDC';

export interface MarketPrice {
  asset: string;
  priceUsd: string;
  priceNgn: string | null;
}
export interface Balance {
  asset: string;
  available: string;
  locked: string;
  availableFormatted: string;
  lockedFormatted: string;
}
export interface Me {
  id: string;
  email: string;
  phone: string | null;
  kycTier: number;
  status: string;
  createdAt: string;
  username: string | null;
  dateOfBirth: string | null;
  nextOfKin: string | null;
  instantWithdrawal: boolean;
  limits: {
    singleTxKobo: string;
    dailyDepositKobo: string;
    dailyWithdrawalKobo: string;
    cryptoWithdrawalEnabled: boolean;
  };
}
export interface VirtualAccount {
  accountNumber: string;
  bankName: string;
  bankCode?: string;
  permanent: boolean;
}
export interface Quote {
  quoteId: string;
  side: 'buy' | 'sell' | 'convert';
  fromAsset: string;
  toAsset: string;
  amountIn: string;
  amountOut: string;
  rate: string;
  expiresAt: string;
}
export interface BillBiller {
  id: string;
  name: string;
  short: string;
  color: string;
  logo: string | null;
  /** True when the biller isn't payable yet (no provider code). */
  comingSoon?: boolean;
}
export interface BillPlan {
  id: string;
  billerId: string;
  name: string;
  amount: string;
}
export interface BillServiceConfig {
  service: 'airtime' | 'data' | 'electricity' | 'cabletv' | 'betting';
  label: string;
  emoji: string;
  customerLabel: string;
  customerPlaceholder: string;
  variableAmount: boolean;
  requiresValidation: boolean;
  billers: BillBiller[];
  plans: BillPlan[];
}
export type LedgerTxType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'BUY'
  | 'SELL'
  | 'CONVERT'
  | 'BILL'
  | 'CASHBACK'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN';
export type LedgerTxStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
export interface LedgerTransaction {
  id: string;
  type: LedgerTxType;
  asset: string;
  network: string | null;
  amount: string;
  amountFormatted: string;
  fee: string;
  feeFormatted: string;
  status: LedgerTxStatus;
  txHash: string | null;
  createdAt: string;
  fromAsset: string | null;
  toAsset: string | null;
  fromFormatted: string | null;
  toFormatted: string | null;
  rate: string | null;
  toAddress: string | null;
  service: string | null;
  billerName: string | null;
  planName: string | null;
  customer: string | null;
  token: string | null;
  counterparty: string | null;
  note: string | null;
}

// ---- Endpoints ----
export const api = {
  /** Idempotently create the app-side profile + wallets. Call after login. */
  async ensureProvisioned(): Promise<void> {
    await apiFetch('/api/me', { method: 'POST' });
    await apiFetch('/api/wallets', { method: 'POST' });
  },

  getMe(): Promise<Me> {
    return apiFetch('/api/me');
  },

  /** Update editable profile fields (username, next of kin, DOB if unverified). */
  updateProfile(patch: {
    username?: string;
    dateOfBirth?: string;
    nextOfKin?: string;
  }): Promise<Me> {
    return apiFetch('/api/me', { method: 'PATCH', body: JSON.stringify(patch) });
  },

  /** Toggle instant withdrawal (skip 2FA on crypto withdrawals). */
  setInstantWithdrawal(enabled: boolean): Promise<{ instantWithdrawal: boolean }> {
    return apiFetch('/api/security/instant-withdrawal', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  },

  /** Permanently delete the account. Refuses if the wallet holds a balance. */
  deleteAccount(): Promise<{ deleted: boolean }> {
    return apiFetch('/api/me', { method: 'DELETE' });
  },

  getBalances(): Promise<{ balances: Balance[] }> {
    return apiFetch('/api/balances');
  },

  getWallets(): Promise<{ wallets: { asset: string; network: string; address: string }[] }> {
    return apiFetch('/api/wallets');
  },

  getPrice(asset: AssetSymbol): Promise<MarketPrice> {
    return apiFetch(`/api/market/${asset}/price`);
  },

  getTransactions(limit = 50): Promise<{ transactions: LedgerTransaction[] }> {
    return apiFetch(`/api/transactions?limit=${limit}`);
  },

  getTransaction(id: string): Promise<{ transaction: LedgerTransaction }> {
    return apiFetch(`/api/transactions/${id}`);
  },

  createQuote(side: 'buy' | 'sell', asset: AssetSymbol, amount: string): Promise<Quote> {
    return apiFetch('/api/quotes', {
      method: 'POST',
      body: JSON.stringify({ side, asset, amount }),
    });
  },

  createConvertQuote(fromAsset: AssetSymbol, toAsset: AssetSymbol, amount: string): Promise<Quote> {
    return apiFetch('/api/quotes/convert', {
      method: 'POST',
      body: JSON.stringify({ fromAsset, toAsset, amount }),
    });
  },

  executeSwap(quoteId: string): Promise<{ transactionId: string; status: string }> {
    return apiFetch('/api/swaps', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey() },
      body: JSON.stringify({ quoteId }),
    });
  },

  /** Live crypto deposit addresses (manual custody). Absent asset = coming soon. */
  getCryptoDepositAddresses(): Promise<{
    addresses: { asset: string; address: string; network: string; networkLabel: string }[];
  }> {
    return apiFetch('/api/crypto/deposit-addresses');
  },

  createCryptoWithdrawal(input: {
    asset: AssetSymbol;
    network: 'BITCOIN' | 'TRON' | 'ETHEREUM' | 'BSC';
    toAddress: string;
    amount: string;
  }): Promise<{ transactionId: string; status: string; txHash?: string }> {
    return apiFetch('/api/withdrawals/crypto', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey() },
      body: JSON.stringify(input),
    });
  },

  createNgnWithdrawal(input: {
    amount: string;
    bankCode: string;
    accountNumber: string;
    narration?: string;
  }): Promise<{ transactionId: string; status: string }> {
    return apiFetch('/api/withdrawals/ngn', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey() },
      body: JSON.stringify(input),
    });
  },

  getKyc(): Promise<{
    kycTier: number;
    limits: {
      singleTxKobo: string;
      dailyDepositKobo: string;
      dailyWithdrawalKobo: string;
      cryptoWithdrawalEnabled: boolean;
    };
    records: { id: string; tier: number; status: string; createdAt: string }[];
    /**
     * Enrolled with the payment provider. Separate from being verified: a
     * verified user with this false has no deposit account and no crypto
     * wallet. Optional because older API deployments don't send it.
     */
    providerEnrolled?: boolean;
    /** Name recorded at verification, used to prefill the form. */
    legalName?: string | null;
    /** YYYY-MM-DD, used to prefill the date picker. */
    dateOfBirth?: string | null;
  }> {
    return apiFetch('/api/kyc');
  },

  submitKyc(input: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
    bvn?: string;
    documentRefs?: string[];
    /**
     * Phone and address are the provider's requirements for enrolling a
     * customer, and a customer id is what a deposit account and a crypto
     * address both hang off. Omitting them silently costs the user both.
     */
    phone?: string;
    address?: { street: string; city: string; state: string; postalCode: string };
  }): Promise<{ id: string; status: string; tier: number; autoVerified: boolean; message: string }> {
    return apiFetch('/api/kyc', { method: 'POST', body: JSON.stringify(input) });
  },

  getNotificationPrefs(): Promise<{ preferences: Record<string, boolean> }> {
    return apiFetch('/api/notifications/preferences');
  },

  updateNotificationPrefs(
    patch: Record<string, boolean>
  ): Promise<{ preferences: Record<string, boolean> }> {
    return apiFetch('/api/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  registerPushToken(token: string): Promise<{ registered: boolean }> {
    return apiFetch('/api/push/register', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  getVirtualAccount(): Promise<{ virtualAccount: VirtualAccount | null }> {
    return apiFetch('/api/virtual-accounts');
  },

  createVirtualAccount(input: {
    firstName: string;
    lastName: string;
    phone?: string;
    bvn?: string;
  }): Promise<{ virtualAccount: VirtualAccount }> {
    return apiFetch('/api/virtual-accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getBillCatalog(): Promise<{ services: BillServiceConfig[] }> {
    return apiFetch('/api/bills/catalog');
  },

  validateBillCustomer(input: {
    service: string;
    billerId: string;
    customer: string;
  }): Promise<{ valid: boolean; customerName: string | null }> {
    return apiFetch('/api/bills/validate', { method: 'POST', body: JSON.stringify(input) });
  },

  payBill(input: {
    service: string;
    billerId: string;
    customer: string;
    planId?: string;
    amount?: string;
  }): Promise<{ transactionId: string; status: string; providerRef?: string; token?: string | null }> {
    return apiFetch('/api/bills/pay', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey() },
      body: JSON.stringify(input),
    });
  },

  // ---- NGN payout (bank accounts / beneficiaries) ----
  getBanks(): Promise<{ banks: Bank[] }> {
    return apiFetch('/api/banks');
  },

  resolveBankAccount(input: {
    accountNumber: string;
    bankCode: string;
  }): Promise<{ accountName: string }> {
    return apiFetch('/api/banks/resolve', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getBeneficiaries(): Promise<{ beneficiaries: Beneficiary[] }> {
    return apiFetch('/api/beneficiaries');
  },

  addBeneficiary(input: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
  }): Promise<{ beneficiary: Beneficiary }> {
    return apiFetch('/api/beneficiaries', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  deleteBeneficiary(id: string): Promise<{ deleted: boolean }> {
    return apiFetch(`/api/beneficiaries/${id}`, { method: 'DELETE' });
  },

  // ---- Support ----
  getSupportContact(): Promise<{ email: string; phone: string; whatsapp: string }> {
    return apiFetch('/api/support/contact');
  },

  /** Admin feature switches — used to hide disabled features in the UI. */
  getFeatures(): Promise<{ features: FeatureFlags }> {
    return apiFetch('/api/features');
  },

  /** Confirm a username exists before sending — never returns PII. */
  lookupUser(username: string): Promise<{ username: string; self: boolean }> {
    return apiFetch(`/api/users/lookup?username=${encodeURIComponent(username)}`);
  },

  /** Send NGN or crypto to another CheqPay user. */
  sendToUser(input: {
    username: string;
    asset: string;
    amount: string;
    note?: string;
  }): Promise<{
    transactionId: string;
    status: string;
    asset: string;
    amountFormatted: string;
    recipient: string;
  }> {
    return apiFetch('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'idempotency-key': idemKey() },
    });
  },

  /** Whether emailed statements are available (email delivery configured). */
  getStatementAvailability(): Promise<{ available: boolean; maxRangeDays: number }> {
    return apiFetch('/api/statements/request');
  },

  /** Generate a statement for the range and email it to the account address. */
  requestStatement(input: {
    from: string;
    to: string;
    format: 'pdf' | 'csv';
  }): Promise<{ sent: boolean; email: string; count: number }> {
    return apiFetch('/api/statements/request', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /** The user's virtual cards + whether issuing is currently available. */
  getCards(): Promise<{ cards: VirtualCard[]; available: boolean }> {
    return apiFetch('/api/cards');
  },

  createCard(): Promise<{ card: VirtualCard }> {
    return apiFetch('/api/cards', { method: 'POST' });
  },

  /** Admin-published in-app popup (null when none is live). */
  getPopup(): Promise<{
    popup: {
      id: string;
      title: string;
      message: string;
      imageUrl: string | null;
      buttonText: string | null;
      buttonUrl: string | null;
    } | null;
  }> {
    return apiFetch('/api/popup');
  },

  supportChat(
    messages: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<{ reply: string; agent: boolean }> {
    return apiFetch('/api/support/chat', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    });
  },
};

export interface FeatureFlags {
  ngn_deposits: boolean;
  ngn_withdrawals: boolean;
  crypto_trading: boolean;
  crypto_deposits: boolean;
  crypto_withdrawals: boolean;
  bill_payments: boolean;
  virtual_cards: boolean;
  p2p_transfers: boolean;
}

export interface VirtualCard {
  id: string;
  currency: string;
  brand: string | null;
  maskedPan: string | null;
  status: string;
  createdAt: string;
}

export interface Bank {
  code: string;
  name: string;
}

export interface Beneficiary {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}
