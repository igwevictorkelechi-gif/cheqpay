/** Crypto assets the backend custodies (launch set). */
export interface CryptoAssetMeta {
  symbol: "BTC" | "USDT";
  name: string;
  network: "BITCOIN" | "TRON";
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
    network: "TRON",
    networkLabel: "Tron (TRC-20)",
    color: "#26A17B",
    glyph: "₮",
    minSend: "2",
    decimals: 6,
  },
];

export function getAssetMeta(symbol: string): CryptoAssetMeta | undefined {
  return CRYPTO_ASSETS.find((a) => a.symbol === symbol.toUpperCase());
}

/** All assets the convert/swap flow can switch between. NGN is the fiat leg. */
export type ConvertSymbol = "NGN" | "BTC" | "USDT";

export const CONVERT_ASSETS: ConvertSymbol[] = ["NGN", "BTC", "USDT"];

export const ASSET_DECIMALS: Record<ConvertSymbol, number> = {
  NGN: 2,
  BTC: 8,
  USDT: 6,
};

export const ASSET_NAMES: Record<ConvertSymbol, string> = {
  NGN: "Nigerian Naira",
  BTC: "Bitcoin",
  USDT: "Tether",
};

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
