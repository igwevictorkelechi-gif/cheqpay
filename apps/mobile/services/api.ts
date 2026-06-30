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

  createQuote(side: 'buy' | 'sell', asset: AssetSymbol, amount: string) {
    return apiFetch<{ quoteId: string; amountOut: string; rate: string }>('/api/quotes', {
      method: 'POST',
      body: JSON.stringify({ side, asset, amount }),
    });
  },

  executeSwap(quoteId: string): Promise<{ transactionId: string; status: string }> {
    return apiFetch('/api/swaps', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey() },
      body: JSON.stringify({ quoteId }),
    });
  },
};
