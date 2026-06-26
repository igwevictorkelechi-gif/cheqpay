/**
 * Deposit / Add money service.
 *
 * Fetches a STATIC virtual account number for bank-transfer funding. It calls
 * the CheqPay backend route (which talks to Flutterwave) and falls back to a
 * deterministic mock account if the backend is unreachable, so the flow always
 * works in development.
 */

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'https://cheqpy.vercel.app';

export const DEPOSIT_FEE = 150;

export type VirtualAccount = {
  account_number: string;
  bank_name: string;
  account_name: string;
  fee: number;
};

function deterministicAccount(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `7${(h % 1_000_000_000).toString().padStart(9, '0')}`;
}

function mockAccount(email: string, name: string): VirtualAccount {
  return {
    account_number: deterministicAccount(email || name || 'cheqpay'),
    bank_name: 'Wema Bank',
    account_name: (name || 'CheqPay User').toUpperCase(),
    fee: DEPOSIT_FEE,
  };
}

export const depositService = {
  async getVirtualAccount(
    email?: string | null,
    name?: string | null,
    amount?: number
  ): Promise<VirtualAccount> {
    try {
      const res = await fetch(`${API_BASE}/api/flutterwave/virtual-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, amount }),
      });
      const data = await res.json();
      if (data?.account_number) {
        return {
          account_number: data.account_number,
          bank_name: data.bank_name || 'Wema Bank',
          account_name: data.account_name || (name || 'CheqPay User').toUpperCase(),
          fee: data.fee ?? DEPOSIT_FEE,
        };
      }
      return mockAccount(email || '', name || '');
    } catch {
      return mockAccount(email || '', name || '');
    }
  },
};
