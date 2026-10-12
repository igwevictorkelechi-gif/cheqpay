'use client';

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Activity, Globe2, Layers, Minus, Plus, Radio, Users, Wallet } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import type { GlobeCell, GlobeLayers, LiveGlobeHandle } from '@/components/LiveGlobe';
import { KIND_COLORS } from '@/components/kindColors';

// WebGL only exists in the browser.
const LiveGlobe = dynamic(() => import('@/components/LiveGlobe'), { ssr: false });

type FeedTx = {
  id: string;
  kind: string;
  label: string;
  amount: string;
  asset: string;
  status: string;
  at: string;
  lat: number | null;
  lon: number | null;
  city: string | null;
  country: string | null;
};
type Place = { name: string; users: number; active: number };
type LiveData = {
  now: string;
  cells: (GlobeCell & { source: 'ip' | 'kyc' })[];
  transactions: FeedTx[];
  kpis: { activeNow: number; usersOnMap: number; totalUsers: number; countries: number; txLastHour: number; ngnVolumeLastHour: string };
  topCities: Place[];
  topCountries: Place[];
};

const POLL_MS = 5000;
const FEED_MAX = 40;

const fmt = (n: number) => n.toLocaleString('en-NG');
const money = (amount: string, asset: string) => {
  const n = Number(amount);
  const sym = asset === 'NGN' ? '₦' : asset === 'USD' ? '$' : '';
  const digits = asset === 'NGN' || asset === 'USD' ? 2 : 6;
  return `${sym}${n.toLocaleString('en-NG', { maximumFractionDigits: digits })}${sym ? '' : ` ${asset}`}`;
};
const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
const flag = (cc: string | null) =>
  cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌐';

export default function LiveMapPage() {
  const globe = useRef<LiveGlobeHandle>(null);
  const [data, setData] = useState<LiveData | null>(null);
  const [feed, setFeed] = useState<FeedTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<GlobeLayers>({ heat: true, active: true, transactions: true });
  const [tick, setTick] = useState(Date.now());
  const seen = useRef(new Set<string>());
  const cursor = useRef<string | null>(null);
  const first = useRef(true);

  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const qs = cursor.current ? `?since=${encodeURIComponent(cursor.current)}` : '';
      const res = await fetch(`/api/live-map${qs}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const d = body as LiveData;
      setData(d);
      setError(null);

      // New transactions, oldest first so the rings fire in order.
      const fresh = d.transactions.filter((t) => !seen.current.has(t.id)).reverse();
      fresh.forEach((t) => seen.current.add(t.id));
      if (fresh.length) {
        const newestFirst = [...fresh].reverse();
        setFeed((f) => [...newestFirst, ...f].slice(0, FEED_MAX));
        // The first load is history: list it, but only ring what arrives live.
        if (!first.current) {
          fresh.forEach((t, i) => {
            if (t.lat === null || t.lon === null) return;
            window.setTimeout(() => globe.current?.ping({ id: t.id, lat: t.lat!, lon: t.lon!, kind: t.kind }), i * 350);
          });
        }
      }
      // Ask only for what's newer next time, with a little overlap.
      cursor.current = new Date(Date.parse(d.now) - 15_000).toISOString();
      first.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the live map.');
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = window.setInterval(poll, POLL_MS);
    const clock = window.setInterval(() => setTick(Date.now()), 1000);
    const onVis = () => !document.hidden && void poll();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [poll]);

  const k = data?.kpis;
  const kycOnly = data ? data.cells.filter((c) => c.source === 'kyc').reduce((n, c) => n + c.users, 0) : 0;

  return (
    <DashboardLayout>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Globe2 className="h-6 w-6 text-brand-400" /> Live map
          </h1>
          <p className="mt-1 text-sm text-gray-500">Where CheqPay users are, who&apos;s active now, and transactions as they happen.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          {error ? 'Reconnecting…' : 'Live'}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Radio} label="Active now" value={k ? fmt(k.activeNow) : '—'} hint="seen in the last 15 min" accent="text-emerald-400" />
        <Kpi icon={Users} label="Users on the map" value={k ? fmt(k.usersOnMap) : '—'} hint={k ? `of ${fmt(k.totalUsers)} · ${k.countries} countr${k.countries === 1 ? 'y' : 'ies'}` : ''} />
        <Kpi icon={Activity} label="Transactions, last hour" value={k ? fmt(k.txLastHour) : '—'} />
        <Kpi icon={Wallet} label="NGN volume, last hour" value={k ? money(k.ngnVolumeLastHour, 'NGN') : '—'} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_340px]">
        <div className="relative h-[68vh] min-h-[420px] overflow-hidden rounded-2xl border border-gray-200 bg-[#0b0a10]">
          {/* (MapLibre sets its own container to position: relative, hence the wrapper.) */}
          <div className="absolute inset-0">
            <MapBoundary>
              <LiveGlobe ref={globe} cells={data?.cells ?? []} layers={layers} className="h-full w-full" />
            </MapBoundary>
          </div>

          {/* Zoom and quick places */}
          <div className="absolute right-3 top-3 flex flex-col gap-2">
            <MapButton label="Zoom in" onClick={() => globe.current?.zoomBy(1)}><Plus className="h-4 w-4" /></MapButton>
            <MapButton label="Zoom out" onClick={() => globe.current?.zoomBy(-1)}><Minus className="h-4 w-4" /></MapButton>
          </div>
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            <Chip onClick={() => globe.current?.flyTo(8, 9, 1.6)}>🌍 World</Chip>
            <Chip onClick={() => globe.current?.flyTo(8.1, 9.2, 5.2)}>🇳🇬 Nigeria</Chip>
            <Chip onClick={() => globe.current?.flyTo(3.38, 6.52, 9.5)}>Lagos</Chip>
            <Chip onClick={() => globe.current?.flyTo(7.49, 9.06, 10)}>Abuja</Chip>
          </div>

          {/* Layers + legend */}
          <div className="absolute bottom-3 left-3 rounded-xl border border-white/10 bg-black/60 p-3 text-xs text-gray-200 backdrop-blur">
            <p className="mb-2 flex items-center gap-1.5 font-semibold text-white"><Layers className="h-3.5 w-3.5" /> Layers</p>
            <Toggle on={layers.heat} onChange={(v) => setLayers((l) => ({ ...l, heat: v }))}>
              <span className="h-2 w-6 rounded-full" style={{ background: 'linear-gradient(90deg,#6B5B95,#EC4899,#FB923C,#FDE047)' }} /> Where users are
            </Toggle>
            <Toggle on={layers.active} onChange={(v) => setLayers((l) => ({ ...l, active: v }))}>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Active now
            </Toggle>
            <Toggle on={layers.transactions} onChange={(v) => setLayers((l) => ({ ...l, transactions: v }))}>
              <span className="h-2.5 w-2.5 rounded-full border-2 border-sky-400" /> Live transactions
            </Toggle>
          </div>
          {error && (
            <p className="absolute bottom-3 right-3 max-w-xs rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300">{error}</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-gray-900">
              Live transactions <span className="text-xs font-normal text-gray-500">newest first</span>
            </h2>
            {feed.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">No transactions in the last 30 minutes yet.</p>
            ) : (
              <ul className="max-h-[38vh] space-y-1 overflow-y-auto pr-1">
                {feed.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => t.lat !== null && t.lon !== null && globe.current?.flyTo(t.lon, t.lat, 9)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: KIND_COLORS[t.kind] ?? KIND_COLORS.other }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{t.label}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {flag(t.country)} {t.city ?? 'Unknown place'} · {ago(t.at, tick)}
                          {t.status !== 'COMPLETED' ? ` · ${t.status.toLowerCase()}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{money(t.amount, t.asset)}</span>
                    </button>
                    <Link href={`/transactions?search=${t.id}`} className="ml-7 text-[11px] text-brand-400 hover:underline">
                      Open transaction
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Top places</h2>
            <PlaceList places={data?.topCities ?? []} />
            <div className="my-3 border-t border-gray-200" />
            <PlaceList places={(data?.topCountries ?? []).map((p) => ({ ...p, name: `${flag(p.name)} ${p.name}` }))} />
            {kycOnly > 0 && (
              <p className="mt-3 text-[11px] leading-snug text-gray-500">
                {fmt(kycOnly)} user{kycOnly === 1 ? ' is' : 's are'} placed by the state on their KYC address until they next use the app.
              </p>
            )}
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Kpi({ icon: Icon, label, value, hint, accent }: { icon: typeof Users; label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ?? 'text-gray-900'}`}>{value}</p>
      {hint ? <p className="text-[11px] text-gray-500">{hint}</p> : null}
    </div>
  );
}

function PlaceList({ places }: { places: Place[] }) {
  if (!places.length) return <p className="text-sm text-gray-500">No locations yet.</p>;
  const max = Math.max(...places.map((p) => p.users));
  return (
    <ul className="space-y-2">
      {places.map((p) => (
        <li key={p.name} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate text-gray-900">{p.name}</span>
            <span className="shrink-0 tabular-nums text-gray-500">
              {fmt(p.users)} {p.active > 0 && <span className="text-emerald-400">· {fmt(p.active)} live</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full bg-brand-400" style={{ width: `${Math.max(4, (p.users / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/60 text-white backdrop-blur hover:bg-black/80"
    >
      {children}
    </button>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/80">
      {children}
    </button>
  );
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="accent-[#8A7BB5]" />
      <span className="flex items-center gap-2">{children}</span>
    </label>
  );
}

/** Keeps a map failure inside the map's box: the feed and numbers carry on. */
class MapBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  componentDidCatch(err: unknown) {
    console.error('[live-map] map crashed', err);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-400">
        <div>
          <p className="font-semibold text-white">The map couldn&apos;t load.</p>
          <p className="mt-1">Live transactions and numbers still update alongside. Reload the page to try again.</p>
          <p className="mt-2 text-[11px] opacity-60">{this.state.error}</p>
        </div>
      </div>
    );
  }
}
