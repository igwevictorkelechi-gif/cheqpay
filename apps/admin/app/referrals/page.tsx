'use client';

import { useEffect, useState } from 'react';
import { Loader2, Megaphone } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Social { platform: string; handle: string; followers: number }
interface Application {
  id: string;
  userId: string;
  email: string;
  kycTier: number;
  fullName: string;
  phone: string;
  socials: Social[];
  niche: string;
  location: string;
  why: string;
  preferredCode: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string | null;
  reviewedBy: string | null;
  createdAt: string;
}

const FILTERS = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const;
const fmtFollowers = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

/**
 * People who applied on influencer.mycheqpay.com. Approve with their code,
 * commission % and earning window (asks for your authenticator code), or
 * reject with a reason they'll see.
 */
export default function ApplicationsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('PENDING');
  const [apps, setApps] = useState<Application[]>([]);
  const [defaults, setDefaults] = useState({ commissionPercent: 20, windowDays: 180 as number | null });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', percent: '20', window: '180', reason: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/referrals/applications?status=${filter}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setApps(data.applications);
      setDefaults(data.defaults);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function expand(a: Application) {
    setOpen(open === a.id ? null : a.id);
    setForm({
      code: (a.preferredCode ?? a.fullName.split(' ')[0] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
      percent: String(defaults.commissionPercent),
      window: defaults.windowDays === null ? '' : String(defaults.windowDays),
      reason: '',
    });
  }

  async function decide(a: Application, approve: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const body = approve
        ? { approve: true, code: form.code, commissionPercent: Number(form.percent), windowDays: form.window ? Number(form.window) : null }
        : { approve: false, reason: form.reason };
      const res = await fetch(`/api/referrals/applications/${a.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setMessage({ kind: 'ok', text: approve ? `${a.fullName} is now an influencer with code ${form.code}.` : 'Application rejected.' });
      setOpen(null);
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  const input = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Influencer applications</h1>
        <p className="mt-2 text-gray-600">Applications from influencer.mycheqpay.com. Turn the program on under Features → Referrals &amp; influencers.</p>
      </div>
      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === f ? 'bg-brand-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}>
            {f === 'PENDING' ? 'To review' : f[0] + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {message && <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : apps.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-500"><Megaphone className="mx-auto mb-2 h-8 w-8" />Nothing here.</div>
      ) : (
        <div className="space-y-3">
          {apps.map((a) => (
            <div key={a.id} className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <button onClick={() => expand(a)} className="flex w-full items-start justify-between gap-4 p-5 text-left">
                <div>
                  <p className="font-semibold text-gray-900">{a.fullName} <span className="font-normal text-gray-500">· {a.email}</span></p>
                  <p className="mt-1 text-sm text-gray-600">
                    {a.socials.map((s) => `${s.platform} ${s.handle} (${fmtFollowers(s.followers)})`).join(' · ')}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">{a.niche || '—'} · {a.location || '—'} · KYC {a.kycTier} · applied {new Date(a.createdAt).toLocaleDateString()}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${a.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : a.status === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{a.status}</span>
              </button>
              {open === a.id && (
                <div className="space-y-4 border-t border-gray-100 p-5">
                  <div className="grid gap-2 text-sm md:grid-cols-2">
                    <p><span className="text-gray-500">Phone:</span> {a.phone}</p>
                    <p><span className="text-gray-500">Preferred code:</span> {a.preferredCode ?? '—'}</p>
                    <p className="md:col-span-2"><span className="text-gray-500">Why:</span> {a.why || '—'}</p>
                    {a.reason && <p className="md:col-span-2 text-red-700">Rejected: {a.reason}</p>}
                  </div>
                  {a.status === 'PENDING' && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 rounded-lg border border-green-200 bg-green-50/40 p-4">
                        <p className="font-semibold text-gray-800">Approve</p>
                        <div className="grid grid-cols-3 gap-2">
                          <label className="text-xs text-gray-600">Code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) })} className={`${input} mt-1 w-full font-mono`} /></label>
                          <label className="text-xs text-gray-600">% of our fee<input value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value.replace(/[^\d.]/g, '') })} className={`${input} mt-1 w-full`} /></label>
                          <label className="text-xs text-gray-600">Days (blank = forever)<input value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value.replace(/\D/g, '') })} className={`${input} mt-1 w-full`} /></label>
                        </div>
                        <button onClick={() => decide(a, true)} disabled={busy || form.code.length < 4} className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                          Approve as influencer
                        </button>
                      </div>
                      <div className="space-y-2 rounded-lg border border-red-200 p-4">
                        <p className="font-semibold text-gray-800">Reject</p>
                        <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} placeholder="The applicant sees this." className={`${input} w-full`} />
                        <button onClick={() => decide(a, false)} disabled={busy || form.reason.trim().length < 3} className="w-full rounded-lg border border-red-300 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-40">Reject</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
