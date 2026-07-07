"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, TrendingUp, TrendingDown } from "lucide-react";
import {
  api,
  ApiError,
  getAccessToken,
  type AssetSymbol,
  type Candle,
  type ChartRange,
} from "@/services/api";
import { readCache, writeCache, invalidateMoneyCaches } from "@/lib/cache";

interface AssetSnapshot {
  priceNgn: string | null;
  priceUsd: string;
  balance: string;
}

const META: Record<AssetSymbol, { name: string; color: string; glyph: string }> = {
  BTC: { name: "Bitcoin", color: "#F7931A", glyph: "₿" },
  USDT: { name: "Tether", color: "#26A17B", glyph: "₮" },
  USDC: { name: "USD Coin", color: "#2775CA", glyph: "$" },
};

const RANGES: ChartRange[] = ["day", "week", "month", "year", "all"];
const RANGE_LABEL: Record<ChartRange, string> = {
  day: "1D",
  week: "1W",
  month: "1M",
  year: "1Y",
  all: "All",
};

function fmtNgn(v: string | null): string {
  if (v === null) return "—";
  return "₦" + Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AssetPage() {
  const router = useRouter();
  const params = useParams<{ symbol: string }>();
  const symbol = (params.symbol || "").toUpperCase() as AssetSymbol;
  const meta = META[symbol];

  const cacheKey = `cheqpay:asset:${symbol}`;
  const cached = readCache<AssetSnapshot>(cacheKey);

  const [range, setRange] = useState<ChartRange>("year");
  const [priceNgn, setPriceNgn] = useState<string | null>(cached?.priceNgn ?? null);
  const [priceUsd, setPriceUsd] = useState<string>(cached?.priceUsd ?? "0");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [balance, setBalance] = useState<string>(cached?.balance ?? "0");
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [showTrade, setShowTrade] = useState<null | "buy" | "sell">(null);

  const loadCore = useCallback(async () => {
    setError(null);
    setNeedsLogin(false);
    try {
      const token = await getAccessToken();
      if (!token) {
        setNeedsLogin(true);
        setError("Please log in to view this asset.");
        return;
      }
      const fetchCore = () =>
        Promise.all([api.getPrice(symbol), api.getBalances()]);
      let price, bals;
      try {
        [price, bals] = await fetchCore();
      } catch (e) {
        // New users may not be provisioned — provision once, then retry.
        if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
          await api.ensureProvisioned();
          [price, bals] = await fetchCore();
        } else {
          throw e;
        }
      }
      setPriceNgn(price.priceNgn);
      setPriceUsd(price.priceUsd);
      const b = bals.balances.find((x) => x.asset === symbol);
      const bf = b?.availableFormatted ?? "0";
      setBalance(bf);
      writeCache<AssetSnapshot>(cacheKey, {
        priceNgn: price.priceNgn,
        priceUsd: price.priceUsd,
        balance: bf,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        const detail = (e.body as { error?: string } | undefined)?.error;
        setError(`Sign-in not accepted by the server: ${detail ?? "unauthorized"}`);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  }, [symbol, cacheKey]);

  useEffect(() => {
    if (!meta) {
      setError("Unsupported asset");
      setLoading(false);
      return;
    }
    loadCore();
  }, [meta, loadCore]);

  useEffect(() => {
    if (!meta) return;
    api
      .getChart(symbol, range)
      .then((r) => setCandles(r.candles))
      .catch(() => setCandles([]));
  }, [symbol, range, meta]);

  const values = useMemo(() => {
    if (candles.length > 0) return candles.map((c) => Number(c.close));
    // Stablecoins may have no candle history — render a flat line at the
    // current NGN value so the chart shows instead of "unavailable".
    if ((symbol === "USDT" || symbol === "USDC") && priceNgn) {
      const p = Number(priceNgn);
      return Array.from({ length: 24 }, () => p);
    }
    return [];
  }, [candles, symbol, priceNgn]);
  const changePct = useMemo(() => {
    if (values.length < 2) return null;
    const first = values[0];
    const last = values[values.length - 1];
    if (!first) return null;
    return ((last - first) / first) * 100;
  }, [values]);

  const balanceNgn = useMemo(() => {
    if (!priceNgn) return null;
    return Number(balance) * Number(priceNgn);
  }, [balance, priceNgn]);

  if (!meta) {
    return (
      <Shell>
        <p className="px-5 pt-10 text-center text-muted">Unsupported asset.</p>
      </Shell>
    );
  }

  const up = (changePct ?? 0) >= 0;

  return (
    <Shell>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-ink active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: meta.color }}
          >
            {meta.glyph}
          </span>
          <span className="font-semibold text-ink">{meta.name}</span>
        </div>
        <div className="h-9 w-9" />
      </div>

      {error ? (
        <div className="px-5 py-16 text-center">
          <p className="text-muted">{error}</p>
          {needsLogin ? (
            <button
              onClick={() => router.push("/login")}
              className="mt-5 rounded-full bg-gradient-to-r from-brand to-brand-light px-7 py-3 font-semibold text-white shadow-lg shadow-brand/30"
            >
              Go to login
            </button>
          ) : (
            <button
              onClick={loadCore}
              className="mt-5 rounded-full bg-card px-7 py-3 font-semibold text-ink"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Your holding */}
          <div className="mt-5 flex flex-col items-center">
            <span className="text-sm text-muted">Your {symbol} balance</span>
            <span className="mt-1 text-lg font-semibold text-ink">
              {balance} {symbol}
              {balanceNgn !== null && (
                <span className="text-muted">
                  {" "}· {fmtNgn(String(balanceNgn))}
                </span>
              )}
            </span>
          </div>

          {/* Price + change */}
          <div className="mt-6 px-5">
            <p className="text-[40px] font-extrabold leading-none text-ink">{fmtNgn(priceNgn)}</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="text-sm text-muted">${Number(priceUsd).toLocaleString()} · Market price</span>
              {changePct !== null && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
                  style={{
                    color: up ? "#34C759" : "#EF4444",
                    backgroundColor: up ? "rgba(52,199,89,0.12)" : "rgba(239,68,68,0.12)",
                  }}
                >
                  {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(changePct).toFixed(2)}%
                </span>
              )}
            </div>
          </div>

          {/* Chart */}
          <div className="mt-6 h-60 px-1">
            {values.length > 1 ? (
              <Sparkline values={values} up={up} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                {loading ? "Loading chart…" : "Chart unavailable"}
              </div>
            )}
          </div>

          {/* Range segmented control */}
          <div className="mx-5 mt-4 flex items-center justify-between rounded-full bg-card p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`flex-1 rounded-full py-2 text-xs font-bold transition-colors ${
                  range === r ? "bg-brand text-white" : "text-muted"
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Buy / Sell action bar */}
      {!error && (
        <div className="fixed inset-x-0 bottom-5 z-30 mx-auto flex max-w-[480px] gap-3 px-5">
          <button
            onClick={() => setShowTrade("sell")}
            className="flex-1 rounded-full border border-border bg-card py-4 font-bold text-ink active:scale-[0.98]"
          >
            Sell
          </button>
          <button
            onClick={() => setShowTrade("buy")}
            className="flex-1 rounded-full bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white shadow-lg shadow-brand/30 active:scale-[0.98]"
          >
            Buy
          </button>
        </div>
      )}

      {showTrade && (
        <TradeSheet
          initialSide={showTrade}
          symbol={symbol}
          balance={balance}
          onClose={() => setShowTrade(null)}
          onDone={() => {
            setShowTrade(null);
            loadCore();
          }}
        />
      )}
    </Shell>
  );
}

function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  const w = 320;
  const h = 220;
  const pad = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
  const color = up ? "#34C759" : "#EF4444";
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark)" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface pb-28">{children}</div>
    </div>
  );
}

function TradeSheet({
  initialSide,
  symbol,
  balance,
  onClose,
  onDone,
}: {
  initialSide: "buy" | "sell";
  symbol: AssetSymbol;
  balance: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof api.createQuote>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const inAsset = side === "buy" ? "NGN" : symbol;
  const buyChips = ["5000", "10000", "50000", "100000"];

  function reset() {
    setQuote(null);
    setMsg(null);
  }

  async function getQuote() {
    setBusy(true);
    setMsg(null);
    try {
      setQuote(await api.createQuote(side, symbol, amount));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not get a quote");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!quote) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.executeSwap(quote.quoteId);
      invalidateMoneyCaches();
      setDone(true);
      setTimeout(onDone, 1100);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Swap failed");
    } finally {
      setBusy(false);
    }
  }

  const fmtOut = quote
    ? quote.toAsset === "NGN"
      ? "₦" + (Number(quote.amountOut) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })
      : `${(Number(quote.amountOut) / (symbol === "BTC" ? 1e8 : 1e6)).toFixed(symbol === "BTC" ? 8 : 6)} ${symbol}`
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-[480px] rounded-t-[28px] border-t border-border bg-card p-6 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-border" />

        {done ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#34C759]/15 text-3xl">
              ✅
            </div>
            <p className="text-lg font-bold text-ink">
              {side === "buy" ? "Purchase complete" : "Sale complete"}
            </p>
            <p className="mt-1 text-sm text-muted">Your balance has been updated.</p>
          </div>
        ) : (
          <>
            {/* Buy/Sell segmented */}
            <div className="mb-5 flex rounded-full bg-surface p-1">
              {(["buy", "sell"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setSide(s);
                    setAmount("");
                    reset();
                  }}
                  className={`flex-1 rounded-full py-2.5 text-sm font-bold capitalize transition-colors ${
                    side === s ? "bg-brand text-white" : "text-muted"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <label className="mb-2 block text-sm text-muted">
              {side === "buy" ? "You pay (Naira)" : `You sell (${symbol})`}
            </label>
            <div className="relative mb-3">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  reset();
                }}
                placeholder={side === "buy" ? "50,000" : "0.001"}
                className="w-full rounded-2xl border border-border bg-surface px-4 py-4 text-2xl font-bold text-ink outline-none focus:border-brand"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">
                {inAsset}
              </span>
            </div>

            {/* Quick chips */}
            {side === "buy" ? (
              <div className="mb-4 flex gap-2">
                {buyChips.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setAmount(c);
                      reset();
                    }}
                    className="flex-1 rounded-full bg-surface py-2 text-xs font-semibold text-ink"
                  >
                    ₦{Number(c).toLocaleString()}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mb-4 flex gap-2">
                <button
                  onClick={() => {
                    setAmount(balance);
                    reset();
                  }}
                  className="flex-1 rounded-full bg-surface py-2 text-xs font-semibold text-ink"
                >
                  Max ({balance} {symbol})
                </button>
              </div>
            )}

            {quote && (
              <div className="mb-4 space-y-2 rounded-2xl bg-surface p-4 text-sm">
                <Row label="You receive" value={fmtOut} strong />
                <Row label="Rate" value={`₦${Number(quote.rate).toLocaleString()} / ${symbol}`} />
                <Row label="Includes spread" value="1.5%" />
              </div>
            )}

            {msg && (
              <p className="mb-3 rounded-lg bg-[#EF4444]/10 px-3 py-2 text-center text-sm text-[#EF4444]">
                {msg}
              </p>
            )}

            {!quote ? (
              <button
                onClick={getQuote}
                disabled={busy || !amount}
                className="w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white shadow-lg shadow-brand/30 disabled:opacity-50"
              >
                {busy ? "Getting quote…" : "Get quote"}
              </button>
            ) : (
              <button
                onClick={confirm}
                disabled={busy}
                className="w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white shadow-lg shadow-brand/30 disabled:opacity-50"
              >
                {busy ? "Processing…" : `Confirm ${side}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={strong ? "font-bold text-ink" : "text-ink"}>{value}</span>
    </div>
  );
}
