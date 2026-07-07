"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronDown, ArrowUpDown, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { CoinBadge } from "@/components/MobileUI";
import { api } from "@/services/api";
import {
  CONVERT_ASSETS,
  ASSET_NAMES,
  formatMinor,
  type ConvertSymbol,
} from "@/lib/cryptoAssets";

type Side = "from" | "to";

function AssetCard({
  role,
  symbol,
  amount,
  balance,
  emphasize,
  onPick,
}: {
  role: string;
  symbol: ConvertSymbol;
  amount: string;
  balance: string;
  emphasize?: boolean;
  onPick: () => void;
}) {
  return (
    <div className="rounded-3xl bg-card p-5">
      <div className="flex items-center justify-between">
        <button onClick={onPick} className="flex items-center gap-2 active:scale-95">
          <CoinBadge symbol={symbol} />
          <span className="text-lg font-bold text-ink">{symbol}</span>
          <ChevronDown className="h-4 w-4 text-muted" />
        </button>
        <span className="text-xs font-semibold tracking-widest text-muted">{role}</span>
      </div>
      <p
        className={`mt-3 truncate text-center font-extrabold text-ink ${
          emphasize ? "text-[40px]" : "text-[34px]"
        } leading-none`}
      >
        {amount}
      </p>
      <p className="mt-2 text-center text-sm text-muted">
        Balance: <span className="font-semibold text-ink">{balance}</span>
      </p>
    </div>
  );
}

/** Resolve which API call a from/to pair uses. */
type CryptoLeg = Exclude<ConvertSymbol, "NGN">;
function resolveMode(fromSym: ConvertSymbol, toSym: ConvertSymbol) {
  if (fromSym === "NGN") return { kind: "buy" as const, crypto: toSym as CryptoLeg };
  if (toSym === "NGN") return { kind: "sell" as const, crypto: fromSym as CryptoLeg };
  return { kind: "convert" as const, crypto: fromSym as CryptoLeg };
}

export default function ConvertPage() {
  const router = useRouter();
  const [fromSym, setFromSym] = useState<ConvertSymbol>("NGN");
  const [toSym, setToSym] = useState<ConvertSymbol>("BTC");
  const [amount, setAmount] = useState("0");
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [out, setOut] = useState("0");
  const [rate, setRate] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Side | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await api.ensureProvisioned();
        const { balances } = await api.getBalances();
        const b: Record<string, string> = {};
        for (const x of balances) b[x.asset] = x.availableFormatted;
        setBalances(b);
      } catch {
        /* not logged in */
      }
    })();
  }, []);

  function reset() {
    setAmount("0");
    setOut("0");
    setRate(null);
    setError(null);
  }

  function choose(side: Side, sym: ConvertSymbol) {
    setPicker(null);
    if (side === "from") {
      if (sym === fromSym) return;
      // Picking the same asset as the other side swaps them.
      if (sym === toSym) setToSym(fromSym);
      setFromSym(sym);
    } else {
      if (sym === toSym) return;
      if (sym === fromSym) setFromSym(toSym);
      setToSym(sym);
    }
    reset();
  }

  function flip() {
    setFromSym(toSym);
    setToSym(fromSym);
    reset();
  }

  const mode = resolveMode(fromSym, toSym);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requote = useCallback(
    (amt: string, f: ConvertSymbol, t: ConvertSymbol) => {
      if (debounce.current) clearTimeout(debounce.current);
      const n = parseFloat(amt || "0") || 0;
      if (n <= 0) {
        setOut("0");
        setRate(null);
        setError(null);
        return;
      }
      debounce.current = setTimeout(async () => {
        setQuoting(true);
        setError(null);
        try {
          const m = resolveMode(f, t);
          const q =
            m.kind === "convert"
              ? await api.createConvertQuote(f as CryptoLeg, t as CryptoLeg, amt)
              : await api.createQuote(m.kind, m.crypto, amt);
          setOut(formatMinor(q.amountOut, t));
          setRate(q.rate);
        } catch (e) {
          setOut("0");
          setRate(null);
          setError(e instanceof Error ? e.message : "Could not get a rate");
        } finally {
          setQuoting(false);
        }
      }, 400);
    },
    []
  );

  useEffect(() => {
    requote(amount, fromSym, toSym);
  }, [amount, fromSym, toSym, requote]);

  const press = (key: string) => {
    setAmount((prev) => {
      if (key === "del") return prev.length <= 1 ? "0" : prev.slice(0, -1);
      if (key === ".") return prev.includes(".") ? prev : prev + ".";
      const next = (prev === "0" ? key : prev + key).replace(/^0+(\d)/, "$1");
      return next.length > 14 ? prev : next;
    });
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

  const canPreview = (parseFloat(amount) || 0) > 0 && !!rate && !error;

  const rateLine = (() => {
    if (error) return null;
    if (!rate) return "Enter an amount to see the rate";
    if (mode.kind === "convert") {
      return `1 ${fromSym} ≈ ${Number(rate).toLocaleString("en-US", {
        maximumFractionDigits: 8,
      })} ${toSym}`;
    }
    return `1 ${mode.crypto} ≈ ₦${Number(rate).toLocaleString("en-NG", {
      maximumFractionDigits: 2,
    })}`;
  })();

  const previewSwap = () => {
    if (!canPreview) return;
    const q = new URLSearchParams({ amount, fromSym, toSym }).toString();
    router.push(`/convert/confirm?${q}`);
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
        <h1 className="flex-1 pr-10 text-center text-lg font-bold text-ink">Convert</h1>
      </div>

      <div className="relative px-5">
        <AssetCard
          role="FROM"
          symbol={fromSym}
          amount={amount}
          balance={`${balances[fromSym] ?? "0"} ${fromSym}`}
          emphasize
          onPick={() => setPicker("from")}
        />

        <div className="relative z-10 -my-4 flex justify-center">
          <button
            onClick={flip}
            className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg active:scale-95"
            style={{ backgroundColor: "#6B5B95" }}
          >
            <ArrowUpDown className="h-5 w-5" />
          </button>
        </div>

        <AssetCard
          role="TO"
          symbol={toSym}
          amount={quoting ? "…" : out}
          balance={`${balances[toSym] ?? "0"} ${toSym}`}
          onPick={() => setPicker("to")}
        />
      </div>

      <div className="px-5 pt-3 text-center text-sm">
        {error ? (
          <span className="text-red-400">{error}</span>
        ) : (
          <span className="text-muted">{rateLine}</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 px-5">
        {keys.map((key) => (
          <button
            key={key}
            onClick={() => press(key)}
            className="flex h-14 items-center justify-center rounded-2xl bg-card text-xl font-semibold text-ink transition active:scale-95"
          >
            {key === "del" ? "⌫" : key}
          </button>
        ))}
      </div>

      <div className="mt-6 px-5">
        <button
          onClick={previewSwap}
          disabled={!canPreview}
          className="w-full rounded-full py-4 text-base font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: "#6B5B95" }}
        >
          Preview Swap
        </button>
      </div>

      {picker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => setPicker(null)}
        >
          <div
            className="w-full max-w-[480px] rounded-t-3xl bg-surface p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">Select asset</h2>
              <button
                onClick={() => setPicker(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {CONVERT_ASSETS.map((sym) => {
                const selected = picker === "from" ? sym === fromSym : sym === toSym;
                return (
                  <button
                    key={sym}
                    onClick={() => choose(picker, sym)}
                    className={`flex w-full items-center justify-between rounded-2xl border p-3 active:scale-[0.99] ${
                      selected ? "border-brand bg-card" : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <CoinBadge symbol={sym} />
                      <div className="text-left">
                        <p className="font-bold text-ink">{sym}</p>
                        <p className="text-xs text-muted">{ASSET_NAMES[sym]}</p>
                      </div>
                    </div>
                    <span className="text-sm text-muted">
                      {balances[sym] ?? "0"} {sym}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
