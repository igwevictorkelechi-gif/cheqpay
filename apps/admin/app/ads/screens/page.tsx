'use client';

import { useEffect, useState } from 'react';
import { Loader2, MapPin, Monitor, Pencil, Plus, Trash2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import ImageUploadField from '@/components/ImageUploadField';

interface Screen { id: string; label: string; online: boolean; lastSeenAt: string | null }
interface Venue {
  id: string;
  name: string;
  category: string;
  description: string;
  photo: string | null;
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  opens: string | null;
  closes: string | null;
  ownerEmail: string | null;
  pricePerDay: number;
  sharePercent: number;
  maxAds: number;
  listed: boolean;
  active: boolean;
  earnedFormatted: string;
  minutesToday: number;
  screens: Screen[];
}

const EMPTY = {
  id: '', name: '', category: 'gym', description: '', photo: '', address: '', city: '', state: 'Lagos', location: '',
  opens: '', closes: '', ownerEmail: '', pricePerDay: '3000', sharePercent: '40', maxAds: '8', listed: true, active: true,
};

/**
 * Partner venues and their screens. Add the venue (who gets paid, and how
 * much a day costs), then pair each TV: open mycheqpay.com/screen on it and
 * type the 6-digit code it shows. Venues listed here also appear in "Places
 * near you" for users. Saving a venue asks for your authenticator code.
 */
export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [states, setStates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pair, setPair] = useState<Record<string, { code: string; label: string }>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/ads/venues', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setVenues(data.venues);
      setCategories(data.categories);
      setStates(data.states);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000); // keep online dots fresh
    return () => clearInterval(id);
  }, []);

  function edit(v: Venue) {
    setForm({
      id: v.id, name: v.name, category: v.category, description: v.description, photo: v.photo ?? '', address: v.address, city: v.city,
      state: v.state, location: v.lat !== null && v.lng !== null ? `${v.lat}, ${v.lng}` : '', opens: v.opens ?? '', closes: v.closes ?? '',
      ownerEmail: v.ownerEmail ?? '', pricePerDay: String(v.pricePerDay), sharePercent: String(v.sharePercent), maxAds: String(v.maxAds),
      listed: v.listed, active: v.active,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ads/venues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(form.id ? { id: form.id } : {}),
          name: form.name, category: form.category, description: form.description, photo: form.photo || null,
          address: form.address, city: form.city, state: form.state, location: form.location.trim() || null,
          opens: form.opens || null, closes: form.closes || null, ownerEmail: form.ownerEmail.trim() || null,
          pricePerDay: Number(form.pricePerDay) || 0, sharePercent: Number(form.sharePercent) || 0, maxAds: Number(form.maxAds) || 8,
          listed: form.listed, active: form.active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      setMessage({ kind: 'ok', text: `Saved ${form.name}.${form.id ? '' : ' Now pair its screen below.'}` });
      setForm(EMPTY);
      setShowForm(false);
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function pairScreen(v: Venue) {
    const p = pair[v.id] ?? { code: '', label: '' };
    setMessage(null);
    const res = await fetch(`/api/ads/venues/${v.id}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage({ kind: 'err', text: data.error ?? 'Failed to pair' });
    setMessage({ kind: 'ok', text: `Screen paired to ${v.name}. It starts playing within a few seconds.` });
    setPair({ ...pair, [v.id]: { code: '', label: '' } });
    await load();
  }

  async function removeScreen(v: Venue, s: Screen) {
    if (!confirm(`Remove "${s.label || 'screen'}" from ${v.name}? It will show a new pairing code.`)) return;
    const res = await fetch(`/api/ads/screens/${s.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? { kind: 'ok', text: 'Screen removed.' } : { kind: 'err', text: data.error ?? 'Failed' });
    await load();
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Venues & screens</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Partner places that show CheqPay Ads on a TV. On the TV, open <b>mycheqpay.com/screen</b> in the browser, then type the 6-digit code it shows below.
            Venues are paid their share for each day their screen was on long enough.
          </p>
        </div>
        <button onClick={() => { setForm(EMPTY); setShowForm(!showForm); }} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">
          <Plus size={16} /> Add venue
        </button>
      </div>
      {message && <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}

      {showForm && (
        <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-3">
          <label className="text-xs font-semibold text-gray-600 md:col-span-2">Venue name<input value={form.name} onChange={set('name')} className={input} /></label>
          <label className="text-xs font-semibold text-gray-600">Type
            <select value={form.category} onChange={set('category')} className={input}>
              {Object.entries(categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-gray-600 md:col-span-3">Short description (shown in Nearby)<textarea value={form.description} onChange={set('description')} rows={2} maxLength={300} className={input} /></label>
          <label className="text-xs font-semibold text-gray-600 md:col-span-2">Street address<input value={form.address} onChange={set('address')} className={input} /></label>
          <label className="text-xs font-semibold text-gray-600">City / area<input value={form.city} onChange={set('city')} className={input} /></label>
          <label className="text-xs font-semibold text-gray-600">State
            <select value={form.state} onChange={set('state')} className={input}>{states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </label>
          <label className="text-xs font-semibold text-gray-600 md:col-span-2">Location — paste a Google Maps link, or “lat, lng”
            <input value={form.location} onChange={set('location')} placeholder="https://maps.google.com/…  or  6.5244, 3.3792" className={input} />
            <span className="font-normal text-gray-500">Used to sort “Places near you” by distance.</span>
          </label>
          <label className="text-xs font-semibold text-gray-600">Opens<input type="time" value={form.opens} onChange={set('opens')} className={input} /></label>
          <label className="text-xs font-semibold text-gray-600">Closes<input type="time" value={form.closes} onChange={set('closes')} className={input} /></label>
          <label className="text-xs font-semibold text-gray-600">Owner&apos;s CheqPay email (gets paid)<input value={form.ownerEmail} onChange={set('ownerEmail')} placeholder="owner@example.com" className={input} /></label>
          <label className="text-xs font-semibold text-gray-600">Advertiser price per day (₦)<input value={form.pricePerDay} onChange={set('pricePerDay')} inputMode="decimal" className={input} /></label>
          <label className="text-xs font-semibold text-gray-600">Venue&apos;s share (%)<input value={form.sharePercent} onChange={set('sharePercent')} inputMode="decimal" className={input} /><span className="font-normal text-gray-500">Paid to the owner per day shown</span></label>
          <label className="text-xs font-semibold text-gray-600">Most ads per day<input value={form.maxAds} onChange={set('maxAds')} inputMode="numeric" className={input} /><span className="font-normal text-gray-500">They rotate, ~10 s each</span></label>
          <div className="md:col-span-3">
            <ImageUploadField label="Photo (shown in Nearby)" value={form.photo} onChange={(v) => setForm({ ...form, photo: v })} shape="wide" />
          </div>
          <div className="flex flex-wrap items-center gap-5 md:col-span-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.listed} onChange={(e) => setForm({ ...form, listed: e.target.checked })} /> Show in “Places near you”</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active (can be booked)</label>
            <button onClick={save} disabled={saving || form.name.trim().length < 2} className="ml-auto rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : form.id ? 'Update venue' : 'Add venue'}</button>
          </div>
        </div>
      )}

      {loading && venues.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : venues.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-500"><Monitor className="mx-auto mb-2 h-8 w-8" />No venues yet. Add your first partner.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {venues.map((v) => (
            <div key={v.id} className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${v.active ? '' : 'opacity-60'}`}>
              <div className="flex gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {v.photo ? <img src={v.photo} alt="" className="h-20 w-28 shrink-0 rounded-lg object-cover" /> : <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg bg-gray-100"><MapPin className="text-gray-400" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-lg font-semibold text-gray-900">{v.name}</p>
                    <button onClick={() => edit(v)} className="text-gray-400 hover:text-gray-700" aria-label="Edit venue"><Pencil size={16} /></button>
                  </div>
                  <p className="text-sm text-gray-500">{categories[v.category] ?? v.category} · {[v.city, v.state].filter(Boolean).join(', ')}{v.opens && v.closes ? ` · ${v.opens}–${v.closes}` : ''}</p>
                  <p className="mt-1 text-sm text-gray-700">₦{v.pricePerDay.toLocaleString()}/day · {v.sharePercent}% to {v.ownerEmail ?? <span className="text-amber-600">no owner set</span>} · earned {v.earnedFormatted}</p>
                  <p className="text-xs text-gray-500">{v.lat !== null ? `📍 ${v.lat.toFixed(4)}, ${v.lng?.toFixed(4)}` : '📍 no map location'} · {v.listed ? 'in Nearby' : 'hidden from Nearby'} · on {Math.floor(v.minutesToday / 60)}h {v.minutesToday % 60}m today</p>
                </div>
              </div>
              <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                {v.screens.length === 0 && <p className="text-sm text-amber-700">No screen paired yet — advertisers can&apos;t book this venue until one is.</p>}
                {v.screens.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${s.online ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <Monitor size={14} className="text-gray-400" /> {s.label || 'Screen'}
                      <span className="text-xs text-gray-500">{s.online ? 'online' : s.lastSeenAt ? `last seen ${new Date(s.lastSeenAt).toLocaleString()}` : 'never connected'}</span>
                    </span>
                    <button onClick={() => removeScreen(v, s)} className="text-gray-400 hover:text-red-600" aria-label="Remove screen"><Trash2 size={14} /></button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input value={pair[v.id]?.code ?? ''} onChange={(e) => setPair({ ...pair, [v.id]: { label: pair[v.id]?.label ?? '', code: e.target.value.replace(/\D/g, '').slice(0, 6) } })} placeholder="6-digit code" className="w-32 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm" />
                  <input value={pair[v.id]?.label ?? ''} onChange={(e) => setPair({ ...pair, [v.id]: { code: pair[v.id]?.code ?? '', label: e.target.value.slice(0, 60) } })} placeholder="Name, e.g. Front desk TV" className="min-w-[160px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <button onClick={() => pairScreen(v)} disabled={(pair[v.id]?.code ?? '').length !== 6} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Pair screen</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
