export type ConvertSymbol = 'NGN' | 'BTC' | 'USDT';

export const CONVERT_ASSETS: ConvertSymbol[] = ['NGN', 'BTC', 'USDT'];

export const ASSET_DECIMALS: Record<ConvertSymbol, number> = { NGN: 2, BTC: 8, USDT: 6 };

export const ASSET_META: Record<ConvertSymbol, { name: string; bg: string; glyph: string }> = {
  NGN: { name: 'Naira', bg: '#2E8B57', glyph: '₦' },
  BTC: { name: 'Bitcoin', bg: '#F7931A', glyph: '₿' },
  USDT: { name: 'Tether', bg: '#26A17B', glyph: '₮' },
};

/** Format a minor-unit string/bigint into a human decimal string. */
export function formatMinor(minor: string | bigint, symbol: ConvertSymbol): string {
  const decimals = ASSET_DECIMALS[symbol];
  const neg = String(minor).startsWith('-');
  const digits = String(minor).replace('-', '').padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals) || '0';
  const frac = decimals > 0 ? digits.slice(digits.length - decimals) : '';
  const wholeFmt = Number(whole).toLocaleString('en-US');
  let out = frac ? `${wholeFmt}.${frac}`.replace(/0+$/, '').replace(/\.$/, '') : wholeFmt;
  if (out === '') out = '0';
  return neg ? `-${out}` : out;
}

/** Crypto send/receive metadata (networks + minimums) for the launch set. */
export const CRYPTO_SEND = {
  BTC: { network: 'BITCOIN' as const, networkLabel: 'Bitcoin', minSend: '0.0001' },
  USDT: { network: 'TRON' as const, networkLabel: 'Tron (TRC-20)', minSend: '2' },
};
