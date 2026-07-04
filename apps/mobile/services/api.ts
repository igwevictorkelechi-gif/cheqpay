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
export type AssetSymbol = 'BTC' | 'USDT';

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
export type LedgerTxType = 'DEPOSIT' | 'WITHDRAWAL' | 'BUY' | 'SELL' | 'CONVERT' | 'BILL';
export type LedgerTxStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
export interface LedgerTransaction {
  id: string;
  type: LedgerTxType;
  asset: string;
  network: string | null;
  amount: string;
  amountFormatted: string;
  fee: string;
  status: LedgerTxStatus;
  txHash: string | null;
  createdAt: string;
  fromAsset: string | null;
  toAsset: string | null;
  fromFormatted: string | null;
  toFormatted: string | null;
  service: string | null;
  billerName: string | null;
  planName: string | null;
  customer: string | null;
}

// ---- Endpoints ----
export const api = {
  /** Idempotently create the app-side profile + wallets. Call after login. */
  async ensureProvisioned(): Promise<void> {
    await apiFetch('/api/me', { method: 'POST' });
    await apiFetch('/api/wallets', { method: 'POST' });
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

  createCryptoWithdrawal(input: {
    asset: AssetSymbol;
    network: 'BITCOIN' | 'TRON';
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

  initDeposit(amount: string): Promise<{
    txRef: string;
    transactionId: string;
    amount: string;
    currency?: string;
  }> {
    return apiFetch('/api/deposits/flutterwave', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey() },
      body: JSON.stringify({ amount }),
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
  }): Promise<{ transactionId: string; status: string; providerRef?: string }> {
    return apiFetch('/api/bills/pay', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey() },
      body: JSON.stringify(input),
    });
  },
};
