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
