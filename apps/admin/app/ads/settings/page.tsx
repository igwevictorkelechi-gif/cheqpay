'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Placement = 'home' | 'receipt' | 'paybills';
interface Settings {
  price: Record<Placement, number>;
  slots: Record<Placement, number>;
  nearbyPrice: number;
  nearbySlots: number;
  minScreenHours: number;
  influencerFeePercent: number;
  influencerMinPay: number;
  influencerMaxPosts: number;
  maxDays: number;
  minAudience: number;
  defaultFrequencyCap: number;
  maxFrequencyCap: number;
}
const PLACEMENTS: { key: Placement; label: string; hint: string }[] = [
  { key: 'home', label: 'Home screen banner', hint: 'Below the balance and quick actions' },
  { key: 'receipt', label: 'After a transaction', hint: 'Success screens and receipts' },
  { key: 'paybills', label: 'Pay bills page', hint: 'Under the services grid' },
];

/** What a day on each placement costs, how many advertisers share it, and the guard rails. Saving asks for your authenticator code. */
export default function AdSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/ads/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.settings ? setS(d.settings) : setMessage({ kind: 'err', text: d.error ?? 'Failed to load' })))
      .catch(() => setMessage({ kind: 'err', text: 'Failed to load' }));
  }, []);

  async function save() {
    if (!s) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ads/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      setS(data.settings);
      setMessage({ kind: 'ok', text: 'Saved. New prices apply to campaigns booked from now on.' });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
  const num = (v: string) => Number(v.replace(/[^\d.]/g, '') || 0);

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Ad prices & settings</h1>
        <p className="mt-2 text-gray-600">Advertisers pay per day, upfront, from their Naira balance. Booked campaigns keep the price they paid.</p>
      </div>
      {message && <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}
      {!s ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="max-w-3xl space-y-6">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-3">Placement</th><th className="px-4 py-3">Price per day (₦)</th><th className="px-4 py-3">Advertisers per day</th></tr>
              </thead>
              <tbody>
                {PLACEMENTS.map((p) => (
                  <tr key={p.key} className="border-t border-gray-100">
                    <td className="px-4 py-3"><p className="font-semibold text-gray-900">{p.label}</p><p className="text-xs text-gray-500">{p.hint}</p></td>
                    <td className="px-4 py-3"><input value={s.price[p.key]} onChange={(e) => setS({ ...s, price: { ...s.price, [p.key]: num(e.target.value) } })} className={input} /></td>
                    <td className="px-4 py-3"><input value={s.slots[p.key]} onChange={(e) => setS({ ...s, slots: { ...s.slots, [p.key]: Math.round(num(e.target.value)) } })} className={input} /><p className="mt-1 text-xs text-gray-500">0 = not for sale</p></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-3">
            <label className="text-xs font-semibold text-gray-600">“Featured in Nearby” price per day (₦)<input value={s.nearbyPrice} onChange={(e) => setS({ ...s, nearbyPrice: num(e.target.value) })} className={input} /><span className="font-normal text-gray-500">Venue owners promoting their own place</span></label>
            <label className="text-xs font-semibold text-gray-600">Featured venues per day<input value={s.nearbySlots} onChange={(e) => setS({ ...s, nearbySlots: Math.round(num(e.target.value)) })} className={input} /></label>
            <label className="text-xs font-semibold text-gray-600">Hours a screen must be on for a day to count<input value={s.minScreenHours} onChange={(e) => setS({ ...s, minScreenHours: num(e.target.value) })} className={input} /><span className="font-normal text-gray-500">Below this the advertiser is refunded that day</span></label>
          </div>
          <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-3">
            <label className="text-xs font-semibold text-gray-600">Influencer posts: CheqPay fee (%)<input value={s.influencerFeePercent} onChange={(e) => setS({ ...s, influencerFeePercent: num(e.target.value) })} className={input} /><span className="font-normal text-gray-500">Added on top of what the creator is paid</span></label>
            <label className="text-xs font-semibold text-gray-600">Lowest pay per post (₦)<input value={s.influencerMinPay} onChange={(e) => setS({ ...s, influencerMinPay: num(e.target.value) })} className={input} /></label>
            <label className="text-xs font-semibold text-gray-600">Most posts per campaign<input value={s.influencerMaxPosts} onChange={(e) => setS({ ...s, influencerMaxPosts: Math.round(num(e.target.value)) })} className={input} /></label>
          </div>
          <p className="-mt-3 text-xs text-gray-500">Each venue screen&apos;s own price and the owner&apos;s share are set per venue under Ads → Venues & screens.</p>
          <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-2">
            <label className="text-xs font-semibold text-gray-600">Longest campaign (days)<input value={s.maxDays} onChange={(e) => setS({ ...s, maxDays: Math.round(num(e.target.value)) })} className={input} /></label>
            <label className="text-xs font-semibold text-gray-600">Smallest audience allowed<input value={s.minAudience} onChange={(e) => setS({ ...s, minAudience: Math.round(num(e.target.value)) })} className={input} /><span className="font-normal text-gray-500">Stops ads aimed at a handful of people</span></label>
            <label className="text-xs font-semibold text-gray-600">Default views per person per day<input value={s.defaultFrequencyCap} onChange={(e) => setS({ ...s, defaultFrequencyCap: Math.round(num(e.target.value)) })} className={input} /></label>
            <label className="text-xs font-semibold text-gray-600">Most views per person per day<input value={s.maxFrequencyCap} onChange={(e) => setS({ ...s, maxFrequencyCap: Math.round(num(e.target.value)) })} className={input} /></label>
          </div>
          <button onClick={save} disabled={saving} className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      )}
    </DashboardLayout>
  );
}
