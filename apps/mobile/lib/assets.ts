export type ConvertSymbol = 'NGN' | 'USD' | 'BTC' | 'USDT';

export const CONVERT_ASSETS: ConvertSymbol[] = ['NGN', 'USD', 'BTC', 'USDT'];

export const ASSET_DECIMALS: Record<ConvertSymbol, number> = { NGN: 2, USD: 2, BTC: 8, USDT: 6 };

export const ASSET_META: Record<ConvertSymbol | 'USDC', { name: string; bg: string; glyph: string }> = {
  NGN: { name: 'Naira', bg: '#2E8B57', glyph: '₦' },
  USD: { name: 'US Dollar', bg: '#22C55E', glyph: '$' },
  BTC: { name: 'Bitcoin', bg: '#F7931A', glyph: '₿' },
  USDT: { name: 'Tether', bg: '#26A17B', glyph: '₮' },
  USDC: { name: 'USD Coin', bg: '#2775CA', glyph: '$' },
};

/** The crypto legs (everything that isn't fiat). */
export type CryptoLeg = 'BTC' | 'USDT';
const CRYPTO_SYMBOLS: CryptoLeg[] = ['BTC', 'USDT'];

/**
 * Which API a from/to pair uses. Buy spends NGN for crypto, sell returns crypto
 * to NGN (both through /api/quotes); everything else — crypto↔crypto and
 * anything touching USD, incl. NGN↔USD — is a convert. Mirrors the server's
 * classifySwap so the two agree.
 */
export function resolveConvertMode(
  fromSym: ConvertSymbol,
  toSym: ConvertSymbol,
):
  | { kind: 'buy'; crypto: CryptoLeg }
  | { kind: 'sell'; crypto: CryptoLeg }
  | { kind: 'convert' } {
  const isCrypto = (s: ConvertSymbol): s is CryptoLeg => (CRYPTO_SYMBOLS as string[]).includes(s);
  if (fromSym === 'NGN' && isCrypto(toSym)) return { kind: 'buy', crypto: toSym };
  if (toSym === 'NGN' && isCrypto(fromSym)) return { kind: 'sell', crypto: fromSym };
  return { kind: 'convert' };
}

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
  // Maplerad custody mints ERC-20 addresses; it has no TRON product.
  USDT: { network: 'ETHEREUM' as const, networkLabel: 'Ethereum (ERC-20)', minSend: '2' },
  USDC: { network: 'ETHEREUM' as const, networkLabel: 'Ethereum (ERC-20)', minSend: '2' },
};

/**
 * Which crypto assets are live for deposits/sends. Custody is Maplerad
 * stablecoin (USDT/USDC on ERC-20); BTC has no custodian and stays "Coming
 * soon". Until an asset's rail is enabled it shows "Coming soon" and its
 * receive/send flows are blocked. Flip an asset on with
 * EXPO_PUBLIC_ENABLED_CRYPTO (comma list, e.g. "USDT,USDC") and rebuild.
 */
const ENABLED_CRYPTO = new Set(
  (process.env.EXPO_PUBLIC_ENABLED_CRYPTO ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

export function isAssetEnabled(symbol: string): boolean {
  return ENABLED_CRYPTO.has(symbol.toUpperCase());
}
