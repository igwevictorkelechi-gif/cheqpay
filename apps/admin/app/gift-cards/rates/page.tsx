'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type CardType = 'PHYSICAL' | 'ECODE';
interface Rate {
  id: string;
  country: string;
  countryName: string;
  cardType: CardType;
  currency: string;
  symbol: string;
  rateMinor: string;
  rateFormatted: string;
  minValue: number;
  maxValue: number;
  active: boolean;
}
interface Brand { id: string; name: string; slug: string; active: boolean; rates: Rate[] }
type Countries = Record<string, { name: string; currency: string; symbol: string }>;

interface Form { brandId: string; country: string; cardType: CardType; rate: string; minValue: string; maxValue: string; active: boolean }
const EMPTY: Form = { brandId: '', country: 'US', cardType: 'ECODE', rate: '', minValue: '10', maxValue: '500', active: true };

/**
 * What we pay for each gift card: ₦ per 1 unit of the card's currency, for each
 * brand × country × card type. Users see the payout before they submit, and it
 * is locked onto their trade. Saving a rate asks for your authenticator code.
 */
export default function GiftCardRatesPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [countries, setCountries] = useState<Countries>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [newBrand, setNewBrand] = useState('');
  const [busyBrand, setBusyBrand] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // What users can pick from: an active brand with at least one active rate.
  const sellable = brands.filter((b) => b.active && b.rates.some((r) => r.active));

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/giftcards/rates', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setBrands(data.brands);
      setCountries(data.countries);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const sym = countries[form.country]?.symbol?.trim() || '$';
  const valid = useMemo(() => {
    const r = Number(form.rate), lo = Number(form.minValue), hi = Number(form.maxValue);
    return !!form.brandId && r > 0 && Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && hi >= lo;
  }, [form]);

  async function save() {
    if (!valid) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/giftcards/rates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId: form.brandId,
          country: form.country,
          cardType: form.cardType,
          rate: Number(form.rate),
          minValue: Number(form.minValue),
          maxValue: Number(form.maxValue),
          active: form.active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      const b = brands.find((x) => x.id === form.brandId);
      setMessage(
        b && !b.active
          ? { kind: 'err', text: `Rate saved, but ${b.name} is switched off, so users can't see it. Switch it on below.` }
          : { kind: 'ok', text: 'Rate saved.' },
      );
      setForm((f) => ({ ...EMPTY, brandId: f.brandId }));
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: Rate) {
    if (!confirm(`Remove the ${r.countryName} ${r.cardType === 'ECODE' ? 'e-code' : 'physical'} rate?`)) return;
    const res = await fetch(`/api/giftcards/rates/${r.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setMessage({ kind: 'err', text: data.error ?? 'Failed to remove' });
    await load();
  }

  async function saveBrand(body: { id?: string; name: string; active?: boolean }) {
    // One request per brand at a time: repeat clicks before the list reloads
    // would all send the same stale value.
    if (busyBrand) return;
    setBusyBrand(body.id ?? 'new');
    try {
      const res = await fetch('/api/giftcards/brands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ kind: 'err', text: data.error ?? 'Failed to save brand' });
      await load();
    } finally {
      setBusyBrand(null);
    }
  }

  function toggleBrand(b: Brand) {
    const live = b.rates.filter((r) => r.active).length;
    if (b.active && live > 0 && !confirm(`Switch off ${b.name}? Users will stop seeing it and can't sell it until you switch it back on.`)) return;
    void saveBrand({ id: b.id, name: b.name, active: !b.active });
  }

  function edit(b: Brand, r: Rate) {
    setForm({
      brandId: b.id,
      country: r.country,
      cardType: r.cardType,
      rate: String(Number(r.rateMinor) / 100),
      minValue: String(r.minValue),
      maxValue: String(r.maxValue),
      active: r.active,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Gift card rates</h1>
        <p className="mt-2 text-gray-600">
          What we pay per 1 unit of each card&apos;s currency. A card only shows in the app once it has an active rate.
          Turn selling on under Features → Sell gift cards.
        </p>
      </div>

      {!loading && brands.length > 0 && sellable.length === 0 && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Users can&apos;t sell any gift cards right now: the app shows &quot;We aren&apos;t buying gift cards right now&quot;.
          A brand appears once it is switched on <b>and</b> has at least one active rate.
        </p>
      )}

      {message && (
        <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}

      <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-7">
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-gray-600">Brand</label>
          <select value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })} className={inputCls}>
            <option value="">Choose…</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? '' : ' (off)'}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Country</label>
          <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className={inputCls}>
            {Object.entries(countries).map(([k, c]) => <option key={k} value={k}>{c.name} ({c.currency})</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Type</label>
          <select value={form.cardType} onChange={(e) => setForm({ ...form, cardType: e.target.value as CardType })} className={inputCls}>
            <option value="ECODE">E-code</option>
            <option value="PHYSICAL">Physical</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">₦ per {sym}1</label>
          <input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value.replace(/[^\d.]/g, '') })} placeholder="1250" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Min / max ({sym})</label>
          <div className="flex gap-1">
            <input value={form.minValue} onChange={(e) => setForm({ ...form, minValue: e.target.value.replace(/\D/g, '') })} className={inputCls} />
            <input value={form.maxValue} onChange={(e) => setForm({ ...form, maxValue: e.target.value.replace(/\D/g, '') })} className={inputCls} />
          </div>
        </div>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
          </label>
          <button onClick={save} disabled={!valid || saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {saving ? 'Saving…' : 'Save rate'}
          </button>
        </div>
        {valid && (
          <p className="text-sm text-gray-600 md:col-span-7">
            Example: a {sym}100 card pays <b>₦{(Number(form.rate) * 100).toLocaleString()}</b>.
          </p>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <input value={newBrand} onChange={(e) => setNewBrand(e.target.value)} placeholder="Add a brand (e.g. Macy's)" className={`${inputCls} max-w-xs`} />
        <button
          onClick={() => { if (newBrand.trim()) { void saveBrand({ name: newBrand.trim() }); setNewBrand(''); } }}
          disabled={busyBrand !== null}
          className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Add brand
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="space-y-3">
          {brands.map((b) => {
            const live = b.rates.filter((r) => r.active).length;
            const status = !b.active
              ? { text: 'Off: hidden from users', cls: 'bg-gray-100 text-gray-600' }
              : live === 0
                ? { text: 'Hidden: no active rate', cls: 'bg-amber-100 text-amber-800' }
                : { text: 'Live in the app', cls: 'bg-green-100 text-green-700' };
            return (
            <div key={b.id} className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <p className={`font-semibold ${b.active ? 'text-gray-900' : 'text-gray-400'}`}>{b.name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.cls}`}>{status.text}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">{live} active rate{live === 1 ? '' : 's'}</span>
                  <button
                    onClick={() => toggleBrand(b)}
                    disabled={busyBrand !== null}
                    className={`rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40 ${
                      b.active ? 'border-gray-300 text-gray-700' : 'border-brand-600 bg-brand-600 text-white'
                    }`}
                  >
                    {busyBrand === b.id ? 'Saving…' : b.active ? 'Turn off' : 'Turn on'}
                  </button>
                </div>
              </div>
              {!b.active && live > 0 && (
                <p className="border-t border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
                  This brand has {live} active rate{live === 1 ? '' : 's'} but is switched off, so users can&apos;t sell it. Turn it on to start buying.
                </p>
              )}
              {b.rates.length > 0 && (
                <table className="w-full border-t border-gray-100 text-sm">
                  <tbody>
                    {b.rates.map((r) => (
                      <tr key={r.id} className="border-t border-gray-50">
                        <td className="px-5 py-2">{r.countryName} ({r.currency})</td>
                        <td className="px-5 py-2">{r.cardType === 'ECODE' ? 'E-code' : 'Physical'}</td>
                        <td className="px-5 py-2 font-semibold">{r.rateFormatted} / {r.symbol.trim()}1</td>
                        <td className="px-5 py-2 text-gray-500">{r.symbol.trim()}{r.minValue}–{r.symbol.trim()}{r.maxValue}</td>
                        <td className="px-5 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.active ? 'On' : 'Off'}</span>
                        </td>
                        <td className="px-5 py-2 text-right">
                          <button onClick={() => edit(b, r)} className="mr-3 text-xs font-semibold text-brand-600">Edit</button>
                          <button onClick={() => remove(r)} className="text-gray-400 hover:text-red-600" aria-label="Remove rate"><Trash2 className="inline h-4 w-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}
