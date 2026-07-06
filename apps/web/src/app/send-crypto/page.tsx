"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { api } from "@/services/api";
import { CRYPTO_ASSETS } from "@/lib/cryptoAssets";
import { useCryptoAvailability } from "@/lib/useCryptoAvailability";

function CoinIcon({ bg, glyph, size = 48 }: { bg: string; glyph: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ backgroundColor: bg, width: size, height: size, fontSize: size * 0.45 }}
    >
      {glyph}
    </span>
  );
}

export default function SendCryptoPickerPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const { entries } = useCryptoAvailability();
  const [bal, setBal] = useState<Record<string, string>>({});
  const [ngn, setNgn] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.ensureProvisioned();
        const [{ balances }, btc, usdt] = await Promise.all([
          api.getBalances(),
          api.getPrice("BTC").catch(() => null),
          api.getPrice("USDT").catch(() => null),
        ]);
        if (!active) return;
        const b: Record<string, string> = {};
        for (const x of balances) b[x.asset] = x.availableFormatted;
        setBal(b);
        const price: Record<string, number> = {
          BTC: btc?.priceNgn ? Number(btc.priceNgn) : 0,
          USDT: usdt?.priceNgn ? Number(usdt.priceNgn) : 0,
        };
        setNgn({
          BTC: Number(b.BTC ?? 0) * price.BTC,
          USDT: Number(b.USDT ?? 0) * price.USDT,
        });
      } catch {
        /* not logged in — show zeros */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const list = useMemo(
    () =>
      CRYPTO_ASSETS.filter(
        (a) =>
          a.symbol.toLowerCase().includes(q.toLowerCase()) ||
          a.name.toLowerCase().includes(q.toLowerCase())
      ),
    [q]
  );

  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4">
        <button
          onClick={() => router.back()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-5 text-4xl font-extrabold text-ink">Send crypto</h1>
        <p className="mt-2 text-sm text-muted">Choose the crypto you want to send.</p>

        {/* Search */}
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5">
          <Search className="h-5 w-5 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-ink placeholder-muted outline-none"
          />
        </div>

        {/* Your assets */}
        <p className="mb-2 mt-7 text-sm font-semibold text-muted">Your assets</p>
        <div className="overflow-hidden rounded-3xl bg-card">
          {list.map((a, i) => {
            const enabled = !!entries[a.symbol];
            const amount = Number(bal[a.symbol] ?? 0);
            const has = amount > 0;
            return (
              <button
                key={a.symbol}
                onClick={() => enabled && router.push(`/send-crypto/${a.symbol}`)}
                disabled={!enabled || !has}
                className={`flex w-full items-center justify-between px-4 py-4 active:bg-surface disabled:opacity-40 ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <CoinIcon bg={a.color} glyph={a.glyph} />
                  <div className="text-left">
                    <p className="text-lg font-bold text-ink">{a.symbol}</p>
                    <p className="text-sm text-muted">{a.name}</p>
                  </div>
                </div>
                {enabled ? (
                  <div className="text-right">
                    <p className="text-lg font-bold text-ink">
                      {bal[a.symbol] ?? "0"} {a.symbol}
                    </p>
                    <p className="text-sm text-muted">
                      ₦{(ngn[a.symbol] ?? 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}
                    </p>
                  </div>
                ) : (
                  <span className="rounded-full bg-brand/15 px-3 py-1.5 text-xs font-bold text-brand-light">
                    Coming soon
                  </span>
                )}
              </button>
            );
          })}
          {list.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted">No assets found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
