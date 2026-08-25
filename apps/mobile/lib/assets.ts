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
  // Default chain: Solana is the one Maplerad documents for withdrawal too.
  USDT: { network: 'SOLANA' as const, networkLabel: 'Solana (SPL)', minSend: '2' },
  USDC: { network: 'SOLANA' as const, networkLabel: 'Solana (SPL)', minSend: '2' },
};

/**
 * Chains a user can receive USDT/USDC on, in the order they are offered.
 *
 * Solana is the default: the only chain Maplerad documents for withdrawal as
 * well as deposit. Deposits on the others auto-convert to USD on arrival
 * (offramp), so the user is never left holding coin on a chain we cannot send
 * from — which is what makes offering them safe.
 */
export const CRYPTO_NETWORKS: { network: string; label: string; offramp: boolean }[] = [
  { network: 'SOLANA', label: 'Solana (SPL)', offramp: false },
  { network: 'BASE', label: 'Base', offramp: true },
  { network: 'POLYGON', label: 'Polygon', offramp: true },
  { network: 'ETHEREUM', label: 'Ethereum (ERC-20)', offramp: true },
  { network: 'TRON', label: 'Tron (TRC-20)', offramp: true },
  { network: 'BSC', label: 'BNB Smart Chain (BEP-20)', offramp: true },
];

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

/**
 * The rate line for a convert, printed in the direction people read it.
 *
 * The server's `rate` on a convert is always TO whole units per 1 FROM whole
 * unit. For a pair with a Naira leg that is unreadable one way round — a real
 * NGN→USD quote prints as "1 NGN = 0.00065 USD" — so a Naira pair is always
 * flipped to Naira per unit of the other currency, which is how every rate in
 * the country is quoted. Crypto↔crypto keeps the server's direction.
 *
 * Only for `convert` quotes: a buy/sell `rate` is already NGN per crypto unit
 * in both directions and is formatted at the call site.
 */
export function formatConvertRate(
  fromSym: ConvertSymbol,
  toSym: ConvertSymbol,
  rate: string,
  joiner = '=',
): string | null {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ngn = (v: number) => `₦${v.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
  if (toSym === 'NGN') return `1 ${fromSym} ${joiner} ${ngn(n)}`;
  if (fromSym === 'NGN') return `1 ${toSym} ${joiner} ${ngn(1 / n)}`;
  return `1 ${fromSym} ${joiner} ${n.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${toSym}`;
}
