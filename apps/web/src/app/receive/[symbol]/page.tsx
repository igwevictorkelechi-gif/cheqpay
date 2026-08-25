"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { ChevronLeft, ChevronDown, Copy, Share2, Check, AlertTriangle } from "lucide-react";
import { api, ApiError } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";
import { getAssetMeta } from "@/lib/cryptoAssets";
import DesktopSidebar from "@/components/DesktopSidebar";

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

/**
 * The whole deposit-address response, cached verbatim.
 *
 * Cached per user session rather than per asset: one request already returns
 * every asset and chain, so a single snapshot serves every receive screen and
 * switching assets costs nothing. Addresses are immutable once minted, which is
 * what makes serving a stale copy safe — the refresh behind it only ever adds
 * chains the user has since generated.
 */
interface DepositCache {
  addresses: {
    asset: string;
    address: string;
    network: string;
    networkLabel: string;
    managed?: boolean;
  }[];
  networks: { network: string; label: string }[];
}

const CACHE_KEY = "cheqpay:crypto:addresses";

export default function ReceiveDetailPage() {
  const router = useRouter();
  const params = useParams<{ symbol: string }>();
  const symbol = (params?.symbol ?? "").toUpperCase();
  const meta = getAssetMeta(symbol);

  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Manual custody: the asset is live only when the admin has configured its
  // deposit wallet; otherwise it renders as "Coming soon".
  const [notLive, setNotLive] = useState(false);
  const [netLabel, setNetLabel] = useState<string | null>(null);
  // Every address this user holds for the asset, one per chain, plus the chains
  // they could still mint. A stablecoin exists on several networks and sending
  // on the wrong one loses the funds, so the choice is explicit and visible.
  const [options, setOptions] = useState<
    { address: string; network: string; networkLabel: string }[]
  >([]);
  const [mintable, setMintable] = useState<{ network: string; label: string }[]>([]);
  const [minting, setMinting] = useState<string | null>(null);

  // Project one snapshot onto the screen. Shared by the cached first paint and
  // the network response so the two can never drift apart.
  const applySnapshot = useCallback(
    (snap: DepositCache, sym: string) => {
      const mine = snap.addresses.filter((x) => x.asset === sym);
      setOptions(mine);
      // Chains with no address yet — offered as "generate" so a user is never
      // stuck because their preferred network was added after they signed up.
      const have = new Set(mine.map((m) => m.network));
      setMintable(snap.networks.filter((n) => !have.has(n.network)));
      if (mine.length > 0) {
        setAddress((prev) => prev ?? mine[0].address);
        setNetLabel((prev) => prev ?? mine[0].networkLabel);
        setNotLive(false);
      } else {
        setNotLive(true);
      }
    },
    [],
  );

  useEffect(() => {
    if (!meta) {
      setError("Unsupported asset.");
      setLoading(false);
      return;
    }
    let active = true;
    setError(null);
    setNeedsAuth(false);
    setNotLive(false);

    // A deposit address never changes once minted, so the stored copy is shown
    // immediately and the network call only confirms it. Without this the
    // screen opens on "Loading…" every single time for an address the database
    // has held since the user verified.
    const cached = readCache<DepositCache>(CACHE_KEY);
    const hadCache = !!cached && cached.addresses.length > 0;
    if (cached) applySnapshot(cached, meta.symbol);
    setLoading(!hadCache);

    (async () => {
      try {
        const { addresses, networks } = await api.getCryptoDepositAddresses();
        if (!active) return;
        const snapshot: DepositCache = { addresses, networks: networks ?? [] };
        writeCache(CACHE_KEY, snapshot);
        applySnapshot(snapshot, meta.symbol);
      } catch (e) {
        if (!active) return;
        // Only a genuine 401 means "sign in" — anything else is a temporary
        // problem loading the address, not an auth issue.
        if (e instanceof ApiError && e.status === 401) {
          setNeedsAuth(true);
          setError("Your session has expired. Please sign in again.");
        } else if (!hadCache) {
          // With a cached address on screen a failed refresh is not worth
          // reporting — the address is still correct and still usable.
          setError("We couldn’t load the deposit address. Please try again.");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [meta, reloadKey]);

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

  /** Mint an address on a chain the user does not have yet. */
  async function generate(network: string) {
    if (!meta) return;
    setMinting(network);
    setError(null);
    try {
      const { wallets } = await api.createWallet(meta.symbol, network);
      // Show the chain the user just asked for, rather than leaving them on the
      // one that happened to be selected. The authoritative re-read follows.
      const minted = wallets?.find((w) => w.asset === meta.symbol && w.network === network);
      if (minted) {
        setAddress(minted.address);
        setNetLabel(mintable.find((m) => m.network === network)?.label ?? network);
      }
      // Re-read rather than trusting the POST response shape.
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "We couldn’t create that address. Please try again."
      );
    } finally {
      setMinting(null);
    }
  }

  if (!meta) {
    return (
      <div className="flex min-h-screen w-full justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
        <div className="min-h-screen w-full max-w-[480px] bg-surface px-5 pt-4 lg:max-w-3xl">
          <button
            onClick={() => router.back()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink active:scale-95"
            aria-label="Go back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="mt-10 text-center text-muted">Unsupported asset.</p>
        </div>
      </div>
    );
  }

  if (!loading && notLive) {
    return (
      <div className="flex min-h-screen w-full justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
        <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4 lg:max-w-3xl">
          <button
            onClick={() => router.back()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink active:scale-95"
            aria-label="Go back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="mt-16 flex flex-col items-center text-center">
            <CoinIcon bg={meta.color} glyph={meta.glyph} size={64} />
            <h1 className="mt-6 text-2xl font-extrabold text-ink">
              {meta.name} deposits are coming soon
            </h1>
            <p className="mt-2 max-w-[300px] text-sm text-muted">
              {meta.symbol} deposits are being enabled and will be available shortly —
              your Naira wallet works as usual.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-8 w-full rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
            >
              Back home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4 lg:max-w-3xl">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink active:scale-95"
            aria-label="Go back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold text-ink">Receive {meta.symbol}</h1>
        </div>

        {/* Asset chip */}
        <div className="mt-6 flex flex-col items-center">
          <CoinIcon bg={meta.color} glyph={meta.glyph} size={56} />
          <p className="mt-3 text-lg font-bold text-ink">{meta.name}</p>
          <p className="text-sm text-muted">{netLabel ?? meta.networkLabel}</p>
        </div>

        {/* Network selector. A stablecoin lives on several chains and the
            address differs per chain, so the choice is explicit — picking one
            swaps the QR and the address below it. Chains with no address yet
            are listed too and minted on selection, so the dropdown shows every
            network the user can receive on rather than only the ready ones. */}
        {(options.length > 1 || mintable.length > 0) && (
          <div className="mt-5">
            <label
              htmlFor="receive-network"
              className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Network
            </label>
            <div className="relative">
              <select
                id="receive-network"
                value={address ?? ""}
                disabled={minting !== null}
                onChange={(e) => {
                  const v = e.target.value;
                  // A "generate:" option has no address yet — mint it first.
                  if (v.startsWith("generate:")) {
                    void generate(v.slice("generate:".length));
                    return;
                  }
                  const picked = options.find((o) => o.address === v);
                  if (picked) {
                    setAddress(picked.address);
                    setNetLabel(picked.networkLabel);
                  }
                }}
                className="w-full appearance-none rounded-2xl border border-border bg-card px-4 py-3.5 pr-10 text-base font-semibold text-ink outline-none focus:border-brand disabled:opacity-60"
              >
                {options.map((o) => (
                  <option key={o.network} value={o.address}>
                    {o.networkLabel}
                  </option>
                ))}
                {mintable.map((n) => (
                  <option key={n.network} value={`generate:${n.network}`}>
                    {n.label} — generate address
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            </div>
            {minting && (
              <p className="mt-2 text-xs text-muted">Creating your {minting} address…</p>
            )}
          </div>
        )}

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
          {!loading && !address && error && (
            <button
              onClick={() =>
                needsAuth ? router.push("/login") : setReloadKey((k) => k + 1)
              }
              className="min-h-[44px] mt-3 rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-white active:scale-95"
            >
              {needsAuth ? "Sign in" : "Try again"}
            </button>
          )}
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
            <span className="text-sm font-semibold text-ink">{netLabel ?? meta.networkLabel}</span>
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
            <span className="font-bold">{netLabel ?? meta.networkLabel}</span> network to this
            address. Sending any other coin or using the wrong network will result in permanent
            loss of funds.
          </p>
        </div>

        {/* Manual crediting note */}
        <div className="mt-4 rounded-2xl bg-card p-4">
          <p className="text-xs leading-relaxed text-muted">
            Your balance is credited after the deposit is confirmed on-chain — usually within
            30 minutes. Contact support with your transaction hash if it takes longer.
          </p>
        </div>
      </div>
    </div>
  );
}
