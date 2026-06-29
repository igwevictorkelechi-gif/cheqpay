"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { ChevronLeft, Copy, Share2, Check, AlertTriangle } from "lucide-react";
import { api } from "@/services/api";
import { getAssetMeta } from "@/lib/cryptoAssets";

function CoinIcon({ bg, glyph, size = 40 }: { bg: string; glyph: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ backgroundColor: bg, width: size, height: size, fontSize: size * 0.45 }}
    >
      {glyph}
    </span>
  );
}

export default function ReceiveDetailPage() {
  const router = useRouter();
  const params = useParams<{ symbol: string }>();
  const symbol = (params?.symbol ?? "").toUpperCase();
  const meta = getAssetMeta(symbol);

  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!meta) {
      setError("Unsupported asset.");
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        await api.ensureProvisioned();
        const { wallets } = await api.getWallets();
        if (!active) return;
        const w =
          wallets.find((x) => x.asset === meta.symbol && x.network === meta.network) ??
          wallets.find((x) => x.asset === meta.symbol);
        if (w?.address) setAddress(w.address);
        else setError("No deposit address available yet. Please try again shortly.");
      } catch {
        if (active) setError("Please sign in to view your deposit address.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [meta]);

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function share() {
    if (!address || !meta) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      await nav
        .share({ title: `My ${meta.symbol} address`, text: address })
        .catch(() => undefined);
    } else {
      copy();
    }
  }

  if (!meta) {
    return (
      <div className="flex min-h-screen w-full justify-center bg-black">
        <div className="min-h-screen w-full max-w-[480px] bg-surface px-5 pt-4">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="mt-10 text-center text-muted">Unsupported asset.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold text-ink">Receive {meta.symbol}</h1>
        </div>

        {/* Asset chip */}
        <div className="mt-6 flex flex-col items-center">
          <CoinIcon bg={meta.color} glyph={meta.glyph} size={56} />
          <p className="mt-3 text-lg font-bold text-ink">{meta.name}</p>
          <p className="text-sm text-muted">{meta.networkLabel}</p>
        </div>

        {/* QR */}
        <div className="mt-6 flex justify-center">
          <div className="rounded-3xl bg-white p-5">
            {address ? (
              <QRCodeSVG value={address} size={208} level="M" includeMargin={false} />
            ) : (
              <div className="flex h-[208px] w-[208px] items-center justify-center text-sm text-gray-400">
                {loading ? "Loading…" : "—"}
              </div>
            )}
          </div>
        </div>

        {/* Address */}
        <div className="mt-6 rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Your {meta.symbol} address
          </p>
          <p className="mt-2 break-all text-sm font-medium text-ink">
            {address ?? (loading ? "Loading…" : error ?? "—")}
          </p>
        </div>

        {/* Copy / Share */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={copy}
            disabled={!address}
            className="flex items-center justify-center gap-2 rounded-2xl bg-card py-3.5 font-bold text-ink active:scale-95 disabled:opacity-40"
          >
            {copied ? <Check className="h-5 w-5 text-green-400" /> : <Copy className="h-5 w-5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={share}
            disabled={!address}
            className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand to-brand-light py-3.5 font-bold text-white active:scale-95 disabled:opacity-40"
          >
            <Share2 className="h-5 w-5" />
            Share
          </button>
        </div>

        {/* Details */}
        <div className="mt-6 overflow-hidden rounded-2xl bg-card">
          <div className="flex items-center justify-between px-4 py-4">
            <span className="text-sm text-muted">Network</span>
            <span className="text-sm font-semibold text-ink">{meta.networkLabel}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-4">
            <span className="text-sm text-muted">Minimum deposit</span>
            <span className="text-sm font-semibold text-ink">
              {meta.minSend} {meta.symbol}
            </span>
          </div>
        </div>

        {/* Risk warning */}
        <div className="mt-6 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-200/90">
            Send only <span className="font-bold">{meta.symbol}</span> on the{" "}
            <span className="font-bold">{meta.networkLabel}</span> network to this address. Sending
            any other coin or using the wrong network will result in permanent loss of funds.
          </p>
        </div>
      </div>
    </div>
  );
}
