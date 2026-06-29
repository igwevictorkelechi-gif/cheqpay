"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ArrowDown } from "lucide-react";
import AppShell from "@/components/AppShell";
import { CoinBadge } from "@/components/MobileUI";
import { api } from "@/services/api";
import { formatMinor, type ConvertSymbol } from "@/lib/cryptoAssets";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

function Leg({ caption, amount, symbol }: { caption: string; amount: string; symbol: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-sm text-muted">{caption}</p>
        <p className="mt-1 truncate text-2xl font-extrabold text-ink">
          {amount} <span className="text-lg">{symbol}</span>
        </p>
      </div>
      <CoinBadge symbol={symbol} size={44} />
    </div>
  );
}

function ConfirmInner() {
  const router = useRouter();
  const params = useSearchParams();
  const amount = params.get("amount") || "0";
  const fromSym = (params.get("fromSym") || "NGN") as ConvertSymbol;
  const toSym = (params.get("toSym") || "BTC") as ConvertSymbol;

  const isConvert = fromSym !== "NGN" && toSym !== "NGN";
  const side: "buy" | "sell" = fromSym === "NGN" ? "buy" : "sell";
  const cryptoAsset = (fromSym === "NGN" ? toSym : fromSym) as "BTC" | "USDT";

  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [out, setOut] = useState("0");
  const [rate, setRate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQuote = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api.ensureProvisioned();
      const q = isConvert
        ? await api.createConvertQuote(
            fromSym as "BTC" | "USDT",
            toSym as "BTC" | "USDT",
            amount
          )
        : await api.createQuote(side, cryptoAsset, amount);
      setQuoteId(q.quoteId);
      setOut(formatMinor(q.amountOut, toSym));
      setRate(q.rate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get a quote");
    } finally {
      setLoading(false);
    }
  }, [isConvert, side, cryptoAsset, amount, fromSym, toSym]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  const confirm = async () => {
    if (!quoteId) return;
    setProcessing(true);
    setError(null);
    try {
      await api.executeSwap(quoteId);
      const q = new URLSearchParams({
        from: amount,
        to: out,
        fromSym,
        toSym,
      }).toString();
      router.replace(`/convert/success?${q}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Swap failed";
      // Expired/used quote → refresh and let the user retry.
      if (/expired|used|consumed/i.test(msg)) {
        setError("Rate expired. Refreshing…");
        setProcessing(false);
        fetchQuote();
        return;
      }
      setError(msg);
      setProcessing(false);
    }
  };

  return (
    <AppShell>
      <div className="flex items-center px-5 pb-2 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 pr-10 text-center text-lg font-bold text-ink">Confirm Swap</h1>
      </div>

      <div className="px-5">
        <div className="relative rounded-3xl bg-card p-5">
          <Leg caption="You pay" amount={amount} symbol={fromSym} />
          <div className="my-4 flex justify-center">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: "#6B5B95" }}
            >
              <ArrowDown className="h-4 w-4" />
            </span>
          </div>
          <Leg caption="You receive" amount={loading ? "…" : out} symbol={toSym} />
        </div>
      </div>

      <div className="mt-4 px-5">
        <div className="rounded-3xl bg-card p-5">
          <Row
            label="Rate"
            value={
              !rate
                ? "—"
                : isConvert
                ? `1 ${fromSym} = ${Number(rate).toLocaleString("en-US", {
                    maximumFractionDigits: 8,
                  })} ${toSym}`
                : `1 ${cryptoAsset} = ₦${Number(rate).toLocaleString("en-NG", {
                    maximumFractionDigits: 2,
                  })}`
            }
          />
          <Row label="Estimated time" value="~ instant" />
          <div className="my-1 border-t border-border" />
          <Row label="You receive" value={loading ? "…" : `${out} ${toSym}`} />
        </div>
      </div>

      {error && <p className="mt-4 px-5 text-center text-sm text-red-400">{error}</p>}

      <div className="mt-6 space-y-3 px-5">
        <button
          onClick={confirm}
          disabled={processing || loading || !quoteId}
          className="w-full rounded-full py-4 text-base font-bold text-white disabled:opacity-60"
          style={{ backgroundColor: "#6B5B95" }}
        >
          {processing ? "Swapping…" : loading ? "Getting rate…" : "Confirm Swap"}
        </button>
        <button
          onClick={() => router.back()}
          disabled={processing}
          className="w-full rounded-full py-3 text-base font-semibold text-muted disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </AppShell>
  );
}

export default function ConfirmSwapPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmInner />
    </Suspense>
  );
}
