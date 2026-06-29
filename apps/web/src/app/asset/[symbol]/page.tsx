"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  api,
  ApiError,
  getAccessToken,
  type AssetSymbol,
  type Candle,
  type ChartRange,
} from "@/services/api";

const META: Record<AssetSymbol, { name: string; color: string; glyph: string }> = {
  BTC: { name: "Bitcoin", color: "#F7931A", glyph: "₿" },
  USDT: { name: "Tether", color: "#26A17B", glyph: "₮" },
};

const RANGES: ChartRange[] = ["day", "week", "month", "year", "all"];
const RANGE_LABEL: Record<ChartRange, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  all: "All",
};

function fmtNgn(v: string | null): string {
  if (v === null) return "—";
  const n = Number(v);
  return "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AssetPage() {
  const router = useRouter();
  const params = useParams<{ symbol: string }>();
  const symbol = (params.symbol || "").toUpperCase() as AssetSymbol;
  const meta = META[symbol];

  const [range, setRange] = useState<ChartRange>("year");
  const [priceNgn, setPriceNgn] = useState<string | null>(null);
  const [priceUsd, setPriceUsd] = useState<string>("0");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [balance, setBalance] = useState<string>("0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [showTrade, setShowTrade] = useState<null | "buy" | "sell">(null);

  const loadCore = useCallback(async () => {
    setError(null);
    setNeedsLogin(false);
    try {
      // Distinguish "not signed in" from "signed in but the API rejected the token".
      const token = await getAccessToken();
      if (!token) {
        setNeedsLogin(true);
        setError("Please log in to view this asset.");
        return;
      }
      await api.ensureProvisioned();
      const [price, bals] = await Promise.all([api.getPrice(symbol), api.getBalances()]);
      setPriceNgn(price.priceNgn);
      setPriceUsd(price.priceUsd);
      const b = bals.balances.find((x) => x.asset === symbol);
      setBalance(b?.availableFormatted ?? "0");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // We had a token but the API rejected it — surface the real reason
        // (e.g. SUPABASE_JWT_SECRET misconfigured) instead of a generic prompt.
        const detail = (e.body as { error?: string } | undefined)?.error;
        setError(`Sign-in not accepted by the server: ${detail ?? "unauthorized"}`);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  }, [symbol]);

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

  const chartData = useMemo(
    () => candles.map((c) => ({ t: c.time, v: Number(c.close) })),
    [candles]
  );
  const changePct = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData[0].v;
    const last = chartData[chartData.length - 1].v;
    if (!first) return null;
    return ((last - first) / first) * 100;
  }, [chartData]);

  if (!meta) {
    return (
      <Shell>
        <p className="px-5 text-muted">Unsupported asset.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3">
        <button onClick={() => router.back()} aria-label="Back" className="p-1 text-ink">
          <ChevronLeft className="h-6 w-6" />
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
        <div className="w-8" />
      </div>
      <p className="mb-4 text-center text-sm text-muted">
        {balance} {symbol} · ${priceUsd}
      </p>

      {error ? (
        <div className="px-5 py-10 text-center">
          <p className="text-muted">{error}</p>
          {needsLogin ? (
            <button
              onClick={() => router.push("/login")}
              className="mt-4 rounded-full bg-brand px-6 py-2 font-semibold text-white"
            >
              Go to login
            </button>
          ) : (
            <button
              onClick={loadCore}
              className="mt-4 rounded-full bg-card px-6 py-2 font-semibold text-ink"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Price */}
          <div className="flex items-end justify-between px-5">
            <div>
              <p className="text-3xl font-extrabold text-ink">{fmtNgn(priceNgn)}</p>
              <p className="text-sm text-muted">Market Price</p>
            </div>
            {changePct !== null && (
              <p
                className="text-sm font-semibold"
                style={{ color: changePct >= 0 ? "#34C759" : "#EF4444" }}
              >
                {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
              </p>
            )}
          </div>

          {/* Chart */}
          <div className="mt-4 h-56 px-3">
            {chartData.length > 1 ? (
              <Sparkline values={chartData.map((d) => d.v)} up={(changePct ?? 0) >= 0} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                {loading ? "Loading chart…" : "Chart unavailable"}
              </div>
            )}
          </div>

          {/* Range tabs */}
          <div className="mt-3 flex justify-around px-4">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                  range === r ? "bg-white text-black" : "text-muted"
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Buy / Sell */}
      {!error && (
        <div className="fixed inset-x-0 bottom-6 mx-auto flex max-w-[480px] gap-3 px-5">
          <button
            onClick={() => setShowTrade("sell")}
            className="flex-1 rounded-full bg-card py-4 font-bold text-ink"
          >
            Sell
          </button>
          <button
            onClick={() => setShowTrade("buy")}
            className="flex-1 rounded-full bg-brand py-4 font-bold text-white"
          >
            Buy
          </button>
        </div>
      )}

      {showTrade && (
        <TradeSheet
          side={showTrade}
          symbol={symbol}
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
  const h = 200;
  const pad = 6;
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
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
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
  side,
  symbol,
  onClose,
  onDone,
}: {
  side: "buy" | "sell";
  symbol: AssetSymbol;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof api.createQuote>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const inAsset = side === "buy" ? "NGN" : symbol;
  const outAsset = side === "buy" ? symbol : "NGN";

  async function getQuote() {
    setBusy(true);
    setMsg(null);
    try {
      const q = await api.createQuote(side, symbol, amount);
      setQuote(q);
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
      setMsg("✅ Done!");
      setTimeout(onDone, 900);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Swap failed");
    } finally {
      setBusy(false);
    }
  }

  const fmtOut = quote
    ? outAsset === "NGN"
      ? "₦" + (Number(quote.amountOut) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })
      : `${(Number(quote.amountOut) / (symbol === "BTC" ? 1e8 : 1e6)).toFixed(symbol === "BTC" ? 8 : 6)} ${symbol}`
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-[480px] rounded-t-3xl bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-xl font-bold capitalize text-ink">
          {side} {symbol}
        </h2>

        <label className="mb-2 block text-sm text-muted">
          Amount in {inAsset === "NGN" ? "Naira (₦)" : symbol}
        </label>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setQuote(null);
          }}
          placeholder={inAsset === "NGN" ? "50000" : "0.001"}
          className="mb-4 w-full rounded-xl border border-border bg-surface px-4 py-3 text-ink outline-none"
        />

        {quote && (
          <div className="mb-4 rounded-xl bg-surface p-4 text-sm">
            <div className="flex justify-between text-muted">
              <span>You receive</span>
              <span className="font-bold text-ink">{fmtOut}</span>
            </div>
            <div className="mt-1 flex justify-between text-muted">
              <span>Rate</span>
              <span>₦{Number(quote.rate).toLocaleString()} / {symbol}</span>
            </div>
          </div>
        )}

        {msg && <p className="mb-3 text-center text-sm text-ink">{msg}</p>}

        {!quote ? (
          <button
            onClick={getQuote}
            disabled={busy || !amount}
            className="w-full rounded-full bg-brand py-4 font-bold text-white disabled:opacity-50"
          >
            {busy ? "Getting quote…" : "Get quote"}
          </button>
        ) : (
          <button
            onClick={confirm}
            disabled={busy}
            className="w-full rounded-full bg-brand py-4 font-bold text-white disabled:opacity-50"
          >
            {busy ? "Processing…" : `Confirm ${side}`}
          </button>
        )}
      </div>
    </div>
  );
}
