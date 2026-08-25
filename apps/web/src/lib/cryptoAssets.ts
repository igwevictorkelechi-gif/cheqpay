/** Crypto assets the backend custodies (launch set). */
/** The chains Maplerad mints stablecoin addresses on. */
export type CryptoNetwork =
  | "SOLANA"
  | "BASE"
  | "POLYGON"
  | "ETHEREUM"
  | "TRON"
  | "BSC"
  | "BITCOIN";

/**
 * Chains a user can receive USDT/USDC on, in the order they are offered.
 *
 * Solana is first and is the default: it is the only chain Maplerad documents
 * for withdrawal as well as deposit. Deposits on the others auto-convert to USD
 * on arrival (offramp), so the user is never left holding coin on a chain we
 * cannot send from — which is what makes offering them safe.
 */
export const CRYPTO_NETWORKS: { network: CryptoNetwork; label: string; offramp: boolean }[] = [
  { network: "SOLANA", label: "Solana (SPL)", offramp: false },
  { network: "BASE", label: "Base", offramp: true },
  { network: "POLYGON", label: "Polygon", offramp: true },
  { network: "ETHEREUM", label: "Ethereum (ERC-20)", offramp: true },
  { network: "TRON", label: "Tron (TRC-20)", offramp: true },
  { network: "BSC", label: "BNB Smart Chain (BEP-20)", offramp: true },
];

export interface CryptoAssetMeta {
  symbol: "BTC" | "USDT" | "USDC";
  name: string;
  network: CryptoNetwork;
  networkLabel: string;
  color: string;
  glyph: string;
  minSend: string; // human min withdrawal amount
  decimals: number;
}

export const CRYPTO_ASSETS: CryptoAssetMeta[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    network: "BITCOIN",
    networkLabel: "Bitcoin",
    color: "#F7931A",
    glyph: "₿",
    minSend: "0.0001",
    decimals: 8,
  },
  {
    symbol: "USDT",
    name: "Tether",
    // Default chain: the one Maplerad documents for withdrawal too.
    network: "SOLANA",
    networkLabel: "Solana (SPL)",
    color: "#26A17B",
    glyph: "₮",
    minSend: "2",
    decimals: 6,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    network: "SOLANA",
    networkLabel: "Solana (SPL)",
    color: "#2775CA",
    glyph: "$",
    minSend: "2",
    decimals: 6,
  },
];

export function getAssetMeta(symbol: string): CryptoAssetMeta | undefined {
  return CRYPTO_ASSETS.find((a) => a.symbol === symbol.toUpperCase());
}

/**
 * Which crypto assets are live for deposits/sends. Custody is Maplerad
 * stablecoin (USDT/USDC on ERC-20); BTC has no custodian and stays "Coming
 * soon". Until an asset is enabled it shows as "Coming soon" and its
 * receive/send flows are blocked. Flip an asset on by setting
 * NEXT_PUBLIC_ENABLED_CRYPTO (comma list, e.g. "USDT,USDC") on the web project
 * and redeploying — but only after the server-side crypto feature flags are on.
 */
const ENABLED_CRYPTO = new Set(
  (process.env.NEXT_PUBLIC_ENABLED_CRYPTO ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

export function isAssetEnabled(symbol: string): boolean {
  return ENABLED_CRYPTO.has(symbol.toUpperCase());
}

/** All assets the convert/swap flow can switch between. NGN and USD are fiat. */
export type ConvertSymbol = "NGN" | "USD" | "BTC" | "USDT" | "USDC";

export const CONVERT_ASSETS: ConvertSymbol[] = ["NGN", "USD", "BTC", "USDT", "USDC"];

export const ASSET_DECIMALS: Record<ConvertSymbol, number> = {
  NGN: 2,
  USD: 2,
  BTC: 8,
  USDT: 6,
  USDC: 6,
};

export const ASSET_NAMES: Record<ConvertSymbol, string> = {
  NGN: "Nigerian Naira",
  USD: "US Dollar",
  BTC: "Bitcoin",
  USDT: "Tether",
  USDC: "USD Coin",
};

/** The crypto legs (everything that isn't fiat). */
export type CryptoLeg = Exclude<ConvertSymbol, "NGN" | "USD">;
const CRYPTO_SYMBOLS: CryptoLeg[] = ["BTC", "USDT", "USDC"];

/**
 * Which API a from/to pair uses. Buy spends NGN for crypto and sell returns
 * crypto to NGN — both go through /api/quotes. Everything else (crypto↔crypto,
 * and anything touching USD, including NGN↔USD) is a convert through
 * /api/quotes/convert. Mirrors the server's classifySwap so the two agree.
 */
export function resolveConvertMode(
  fromSym: ConvertSymbol,
  toSym: ConvertSymbol
):
  | { kind: "buy"; crypto: CryptoLeg }
  | { kind: "sell"; crypto: CryptoLeg }
  | { kind: "convert" } {
  const isCrypto = (s: ConvertSymbol): s is CryptoLeg =>
    (CRYPTO_SYMBOLS as string[]).includes(s);
  if (fromSym === "NGN" && isCrypto(toSym)) return { kind: "buy", crypto: toSym };
  if (toSym === "NGN" && isCrypto(fromSym)) return { kind: "sell", crypto: fromSym };
  return { kind: "convert" };
}

/** Format a minor-unit string/bigint into a human decimal string for display. */
export function formatMinor(minor: string | bigint, symbol: ConvertSymbol): string {
  const decimals = ASSET_DECIMALS[symbol];
  const neg = String(minor).startsWith("-");
  const digits = String(minor).replace("-", "").padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals) || "0";
  const frac = decimals > 0 ? digits.slice(digits.length - decimals) : "";
  const wholeFmt = Number(whole).toLocaleString("en-US");
  let out = frac
    ? `${wholeFmt}.${frac}`.replace(/0+$/, "").replace(/\.$/, "")
    : wholeFmt;
  if (out === "") out = "0";
  return neg ? `-${out}` : out;
}
