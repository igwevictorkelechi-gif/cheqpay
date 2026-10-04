'use client';

import { useEffect, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Influencer {
  userId: string;
  code: string;
  commissionPercent: number;
  windowDays: number | null;
  active: boolean;
  email: string;
  username: string | null;
  signups: number;
  qualified: number;
  clicks: number;
  earnedFormatted: string;
  createdAt: string;
  link: string;
}

const EMPTY = { user: '', code: '', percent: '20', window: '180', active: true };

/** Everyone in the influencer program: their code, terms and results. Add someone directly, or edit terms. */
export default function InfluencersPage() {
  const [list, setList] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/referrals/influencers', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setList(data.influencers);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(body: typeof EMPTY) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/referrals/influencers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user: body.user,
          code: body.code,
          commissionPercent: Number(body.percent),
          windowDays: body.window ? Number(body.window) : null,
          active: body.active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      setMessage({ kind: 'ok', text: `Saved ${body.code}.` });
      setForm(EMPTY);
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Influencers</h1>
        <p className="mt-2 text-gray-600">Influencers earn their % of CheqPay&apos;s fee on every transaction their referrals make, for their window. Saving asks for your authenticator code.</p>
      </div>
      {message && <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}

      <div className="mb-6 grid gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-6">
        <label className="text-xs font-semibold text-gray-600 md:col-span-2">Email or @username<input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} className={`${input} mt-1`} /></label>
        <label className="text-xs font-semibold text-gray-600">Code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) })} className={`${input} mt-1 font-mono`} /></label>
        <label className="text-xs font-semibold text-gray-600">% of our fee<input value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value.replace(/[^\d.]/g, '') })} className={`${input} mt-1`} /></label>
        <label className="text-xs font-semibold text-gray-600">Days (blank = forever)<input value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value.replace(/\D/g, '') })} className={`${input} mt-1`} /></label>
        <div className="flex items-end">
          <button onClick={() => save(form)} disabled={saving || !form.user || form.code.length < 4} className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {saving ? 'Saving…' : 'Add / update'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-3">Influencer</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Terms</th><th className="px-4 py-3">Clicks</th><th className="px-4 py-3">Sign-ups</th><th className="px-4 py-3">Qualified</th><th className="px-4 py-3">Earned</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">No influencers yet.</td></tr>}
              {list.map((i) => (
                <tr key={i.userId} className="border-t border-gray-100">
                  <td className="px-4 py-3"><p className="text-gray-900">{i.email}</p>{i.username && <p className="text-xs text-gray-500">@{i.username}</p>}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono font-semibold">{i.code}</span>
                    <button onClick={() => navigator.clipboard.writeText(i.link)} className="ml-2 text-gray-400 hover:text-gray-700" aria-label="Copy link"><Copy className="inline h-3.5 w-3.5" /></button>
                  </td>
                  <td className="px-4 py-3">{i.commissionPercent}% · {i.windowDays ? `${i.windowDays} days` : 'forever'}</td>
                  <td className="px-4 py-3">{i.clicks}</td>
                  <td className="px-4 py-3">{i.signups}</td>
                  <td className="px-4 py-3">{i.qualified}</td>
                  <td className="px-4 py-3 font-semibold">{i.earnedFormatted}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setForm({ user: i.email, code: i.code, percent: String(i.commissionPercent), window: i.windowDays ? String(i.windowDays) : '', active: i.active })} className="mr-3 text-xs font-semibold text-brand-600">Edit</button>
                    <button
                      onClick={() => save({ user: i.email, code: i.code, percent: String(i.commissionPercent), window: i.windowDays ? String(i.windowDays) : '', active: !i.active })}
                      className={`text-xs font-semibold ${i.active ? 'text-red-600' : 'text-green-600'}`}
                    >
                      {i.active ? 'Pause' : 'Resume'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}
