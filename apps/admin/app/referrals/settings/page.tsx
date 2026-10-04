'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Settings {
  basicBonus: number;
  welcomeEnabled: boolean;
  welcomeBonus: number;
  qualifyMin: number;
  defaultCommissionPercent: number;
  defaultWindowDays: number | null;
  holdHours: number;
  monthlyCap: number;
}
interface Earning {
  id: string;
  kind: string;
  amountFormatted: string;
  status: 'HELD' | 'PAID' | 'VOID';
  note: string | null;
  releaseAt: string;
  voidReason: string | null;
  createdAt: string;
  email: string;
}
interface Overview {
  heldFormatted: string;
  paidFormatted: string;
  voidFormatted: string;
  top: { userId: string; email: string; code: string | null; totalFormatted: string }[];
  recent: Earning[];
}

const KIND: Record<string, string> = { COMMISSION: 'Commission', BASIC_BONUS: 'Referral bonus', WELCOME_BONUS: 'Welcome bonus', TASK: 'Task' };

/** What referrals pay, and everything that has been earned. Saving settings asks for your authenticator code. */
export default function ReferralSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [o, setO] = useState<Overview | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    const [a, b] = await Promise.all([
      fetch('/api/referrals/settings', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/referrals/earnings', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    if (a.error || b.error) setMessage({ kind: 'err', text: a.error ?? b.error });
    if (a.settings) setS(a.settings);
    if (!b.error) setO(b);
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!s) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/referrals/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      setS(data.settings);
      setMessage({ kind: 'ok', text: 'Settings saved.' });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function voidOne(e: Earning) {
    const reason = prompt(`Void ${e.amountFormatted} for ${e.email}? Give a reason:`);
    if (!reason || reason.trim().length < 3) return;
    const res = await fetch(`/api/referrals/earnings/${e.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? { kind: 'ok', text: 'Earning voided.' } : { kind: 'err', text: data.error ?? 'Failed' });
    await load();
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    s && setS({ ...s, [k]: e.target.value === '' && k === 'defaultWindowDays' ? null : Number(e.target.value.replace(/[^\d.]/g, '') || 0) });

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Referral earnings &amp; settings</h1>
      </div>
      {message && <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}

      {o && (
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          {[['On hold', o.heldFormatted, 'text-amber-700'], ['Paid', o.paidFormatted, 'text-green-700'], ['Voided', o.voidFormatted, 'text-gray-500']].map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">{l}</p>
              <p className={`mt-1 text-2xl font-bold ${c}`}>{v}</p>
            </div>
          ))}
        </div>
      )}

      {!s ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="mb-8 grid gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-4">
          <label className="text-xs font-semibold text-gray-600">Referral bonus (₦)<input value={s.basicBonus} onChange={num('basicBonus')} className={`${input} mt-1`} /><span className="font-normal text-gray-500">Paid to a regular user per qualified friend</span></label>
          <label className="text-xs font-semibold text-gray-600">Qualifies at (₦)<input value={s.qualifyMin} onChange={num('qualifyMin')} className={`${input} mt-1`} /><span className="font-normal text-gray-500">Verified ID + first transaction of at least this</span></label>
          <label className="text-xs font-semibold text-gray-600">Welcome bonus (₦)<input value={s.welcomeBonus} onChange={num('welcomeBonus')} className={`${input} mt-1`} />
            <span className="mt-1 flex items-center gap-2 font-normal text-gray-600"><input type="checkbox" checked={s.welcomeEnabled} onChange={(e) => setS({ ...s, welcomeEnabled: e.target.checked })} /> Pay new users too</span>
          </label>
          <label className="text-xs font-semibold text-gray-600">Hold (hours)<input value={s.holdHours} onChange={num('holdHours')} className={`${input} mt-1`} /><span className="font-normal text-gray-500">Before an earning is paid</span></label>
          <label className="text-xs font-semibold text-gray-600">Default influencer %<input value={s.defaultCommissionPercent} onChange={num('defaultCommissionPercent')} className={`${input} mt-1`} /></label>
          <label className="text-xs font-semibold text-gray-600">Default window (days, blank = forever)<input value={s.defaultWindowDays ?? ''} onChange={num('defaultWindowDays')} className={`${input} mt-1`} /></label>
          <label className="text-xs font-semibold text-gray-600">Monthly cap per person (₦)<input value={s.monthlyCap} onChange={num('monthlyCap')} className={`${input} mt-1`} /></label>
          <div className="flex items-end">
            <button onClick={save} disabled={saving} className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save settings'}</button>
          </div>
        </div>
      )}

      {o && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <p className="px-4 pt-4 font-semibold text-gray-900">Recent earnings</p>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {o.recent.length === 0 && <tr><td className="px-4 py-8 text-center text-gray-500">Nothing yet.</td></tr>}
                {o.recent.map((e) => (
                  <tr key={e.id} className="border-t border-gray-100">
                    <td className="px-4 py-2">{e.email}</td>
                    <td className="px-4 py-2">{KIND[e.kind] ?? e.kind}{e.note && e.kind === 'TASK' ? `: ${e.note}` : ''}</td>
                    <td className="px-4 py-2 font-semibold">{e.amountFormatted}</td>
                    <td className="px-4 py-2 text-xs">
                      {e.status === 'HELD' ? `Held until ${new Date(e.releaseAt).toLocaleString()}` : e.status === 'PAID' ? 'Paid' : `Void: ${e.voidReason ?? ''}`}
                    </td>
                    <td className="px-4 py-2 text-right">{e.status === 'HELD' && <button onClick={() => voidOne(e)} className="text-xs font-semibold text-red-600">Void</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="mb-2 font-semibold text-gray-900">Top earners</p>
            {o.top.map((t) => (
              <div key={t.userId} className="flex justify-between border-t border-gray-100 py-2 text-sm">
                <span className="truncate">{t.code ?? t.email}</span>
                <span className="font-semibold">{t.totalFormatted}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
