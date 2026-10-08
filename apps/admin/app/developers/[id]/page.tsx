'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileText, Loader2, ShieldAlert } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import { dollars, money, naira } from '@/lib/devFormat';

interface Detail {
  id: string;
  account: {
    id: string;
    business_name: string;
    status: string;
    review_note: string | null;
    submitted_at: string | null;
    reviewed_at: string | null;
    live_since: string | null;
    application: Record<string, string> | null;
    frozen: boolean;
    frozen_by: string | null;
    frozen_reason: string | null;
    suspended_reason: string | null;
    require_ip_allowlist: boolean;
    created_at: string;
  };
  has_document: boolean;
  owner: { email: string; kyc_tier: number; legal_name: string | null; status: string } | null;
  subscription: { plan_id: string; status: string; current_period_end: string; cancel_at_period_end: boolean; next_plan_id: string | null } | null;
  limits: {
    new_account: boolean;
    daily_outflow: { NGN: number; USD: number };
    max_balance: { NGN: number; USD: number };
    max_single_payment: { NGN: number; USD: number };
  };
  overrides: { daily_out_limit_ngn: number | null; daily_out_limit_usd: number | null; max_float_ngn: number | null; max_float_usd: number | null };
  keys: { test: number; live: number };
  wallets: { id: string; currency: string; available_balance: number; status: string; livemode: boolean }[];
  recent_live_transactions: { id: string; kind: string; status: string; currency: string; amount: number; fee: number; description: string | null; created_at: string }[];
  audit: { actor: string; action: string; ip: string | null; created_at: string }[];
}

const APP_FIELDS: [string, string][] = [
  ['legal_name', 'Legal name'],
  ['rc_number', 'CAC number'],
  ['business_type', 'Type'],
  ['website', 'Website'],
  ['contact_phone', 'Phone'],
  ['address', 'Address'],
  ['expected_monthly_volume', 'Expected monthly volume'],
  ['use_case', 'What they will build'],
];

const toUnits = (minor: number | null) => (minor === null ? '' : String(minor / 100));
const fromUnits = (v: string) => (v.trim() === '' ? null : Number(v));

/**
 * One developer account. Review the business before approving: approval opens
 * live money movement. Every action here asks for your authenticator code.
 */
export default function DeveloperDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [limits, setLimits] = useState({ daily_out_ngn: '', daily_out_usd: '', max_float_ngn: '', max_float_usd: '' });
  const [doc, setDoc] = useState<{ content_type: string; url: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/developers/${id}`, { cache: 'no-store' });
    const data = await r.json();
    if (!r.ok) {
      setMessage({ kind: 'err', text: data.error ?? 'Failed to load' });
      return;
    }
    setD(data);
    setLimits({
      daily_out_ngn: toUnits(data.overrides.daily_out_limit_ngn),
      daily_out_usd: toUnits(data.overrides.daily_out_limit_usd),
      max_float_ngn: toUnits(data.overrides.max_float_ngn),
      max_float_usd: toUnits(data.overrides.max_float_usd),
    });
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch(`/api/developers/${id}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Failed');
      setMessage({ kind: 'ok', text: done });
      setReason('');
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function viewDocument() {
    setMessage(null);
    const r = await fetch(`/api/developers/${id}/document`, { cache: 'no-store' });
    const data = await r.json();
    if (!r.ok) return setMessage({ kind: 'err', text: data.error ?? 'Could not load the document' });
    const bytes = Uint8Array.from(atob(data.data_url.split(',')[1]), (c) => c.charCodeAt(0));
    setDoc({ content_type: data.content_type, url: URL.createObjectURL(new Blob([bytes], { type: data.content_type })) });
  }

  const limitBody = {
    daily_out_ngn: fromUnits(limits.daily_out_ngn),
    daily_out_usd: fromUnits(limits.daily_out_usd),
    max_float_ngn: fromUnits(limits.max_float_ngn),
    max_float_usd: fromUnits(limits.max_float_usd),
  };
  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
  const a = d?.account;

  return (
    <DashboardLayout>
      <Link href="/developers" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> All developers
      </Link>
      {message && <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}
      {!d || !a ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{a.application?.legal_name ?? a.business_name}</h1>
              <p className="mt-1 text-gray-600">
                {d.owner?.email} · owner KYC tier {d.owner?.kyc_tier ?? 0} · opened {new Date(a.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700">{a.status.replace('_', ' ')}</span>
              {a.frozen && <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">Frozen by {a.frozen_by}</span>}
            </div>
          </div>
          {a.frozen && a.frozen_reason && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">Frozen: {a.frozen_reason}</p>}
          {a.suspended_reason && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">Suspended: {a.suspended_reason}</p>}

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Business application</h2>
            {a.application ? (
              <dl className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                {APP_FIELDS.map(([k, label]) => (
                  <div key={k} className={k === 'use_case' ? 'md:col-span-2' : ''}>
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="whitespace-pre-wrap break-words text-gray-900">{a.application?.[k] ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-gray-500">No application yet — this account only uses the sandbox.</p>
            )}
            {d.has_document && (
              <button onClick={viewDocument} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700">
                <FileText className="h-4 w-4" /> View registration certificate
              </button>
            )}
            {doc && (
              <div className="mt-4 rounded-lg border border-gray-200 p-3">
                {doc.content_type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={doc.url} alt="Registration certificate" className="max-h-[600px] w-auto" />
                ) : (
                  <a href={doc.url} download="registration-certificate.pdf" className="text-sm font-semibold text-brand-600 underline">
                    Download the PDF
                  </a>
                )}
              </div>
            )}
            <p className="mt-4 text-xs text-gray-500">Check the CAC number against the CAC public search, that the website is real and theirs, and that the use case is one we serve.</p>
          </section>

          {a.status === 'pending_review' && (
            <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
              <h2 className="mb-2 text-lg font-semibold text-gray-900">Decide</h2>
              <p className="mb-3 text-sm text-gray-700">Optional: set this business’s own limits (₦ / $). Leave blank to use the platform defaults on the Plans & limits page.</p>
              <div className="mb-3 grid gap-3 md:grid-cols-4">
                {(['daily_out_ngn', 'daily_out_usd', 'max_float_ngn', 'max_float_usd'] as const).map((k) => (
                  <label key={k} className="text-sm text-gray-700">
                    {k === 'daily_out_ngn' ? 'Daily outflow ₦' : k === 'daily_out_usd' ? 'Daily outflow $' : k === 'max_float_ngn' ? 'Max balance ₦' : 'Max balance $'}
                    <input value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value.replace(/[^\d.]/g, '') })} className={input} placeholder="default" />
                  </label>
                ))}
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the business (required to reject; they see it)" className={`${input} mb-3`} rows={2} />
              <div className="flex flex-wrap gap-2">
                <button disabled={busy || note.trim().length < 10} onClick={() => call('review', { approve: false, note }, 'Rejected. The business has been emailed.')} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-40">
                  Reject
                </button>
                <button disabled={busy} onClick={() => call('review', { approve: true, note: note || undefined, limits: limitBody }, 'Approved. Live access opens once they choose a plan.')} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                  Approve for live
                </button>
              </div>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
              <h2 className="mb-3 text-lg font-semibold text-gray-900">Plan, limits and keys</h2>
              <p>
                <span className="text-gray-500">Plan:</span>{' '}
                {d.subscription ? `${d.subscription.plan_id} (${d.subscription.status}), renews ${new Date(d.subscription.current_period_end).toLocaleDateString()}${d.subscription.next_plan_id ? ` → ${d.subscription.next_plan_id}` : ''}${d.subscription.cancel_at_period_end ? ', cancelling' : ''}` : 'none'}
              </p>
              <p><span className="text-gray-500">Active keys:</span> {d.keys.test} test · {d.keys.live} live</p>
              <p><span className="text-gray-500">Daily outflow:</span> {naira(d.limits.daily_outflow.NGN)} · {dollars(d.limits.daily_outflow.USD)}{d.limits.new_account ? ' (new-account limits)' : ''}</p>
              <p><span className="text-gray-500">Max balance:</span> {naira(d.limits.max_balance.NGN)} · {dollars(d.limits.max_balance.USD)}</p>
              <p><span className="text-gray-500">IP allowlist required on live keys:</span> {a.require_ip_allowlist ? 'yes' : 'no'}</p>
              <div className="mt-3 space-y-1">
                {d.wallets.map((w) => (
                  <p key={w.id}>
                    <span className="text-gray-500">{w.livemode ? 'Live' : 'Test'} {w.currency} main wallet:</span> {money(w.available_balance, w.currency)}
                    {w.status === 'frozen' && <span className="ml-2 text-red-700">frozen</span>}
                  </p>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <ShieldAlert className="h-5 w-5" /> Controls
              </h2>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (needed to suspend or freeze; the business sees it)" className={`${input} mb-3`} />
              <div className="flex flex-wrap gap-2 text-sm">
                {a.status === 'suspended' ? (
                  <button disabled={busy} onClick={() => call('action', { action: 'unsuspend' }, 'Unsuspended.')} className="rounded-lg border border-gray-300 px-3 py-2 font-semibold">Unsuspend</button>
                ) : (
                  <button disabled={busy || reason.trim().length < 10} onClick={() => call('action', { action: 'suspend', reason }, 'Suspended: every key stopped working.')} className="rounded-lg border border-red-300 px-3 py-2 font-semibold text-red-700 disabled:opacity-40">Suspend (all keys stop)</button>
                )}
                {a.frozen ? (
                  <button disabled={busy} onClick={() => call('action', { action: 'unfreeze' }, 'Unfrozen.')} className="rounded-lg border border-gray-300 px-3 py-2 font-semibold">Unfreeze money</button>
                ) : (
                  <button disabled={busy || reason.trim().length < 10} onClick={() => call('action', { action: 'freeze', reason }, 'Frozen: money movement paused.')} className="rounded-lg border border-red-300 px-3 py-2 font-semibold text-red-700 disabled:opacity-40">Freeze money</button>
                )}
                <button disabled={busy} onClick={() => call('action', { action: 'revoke_keys', mode: 'live' }, 'Live keys revoked.')} className="rounded-lg border border-red-300 px-3 py-2 font-semibold text-red-700">Revoke live keys</button>
                <button disabled={busy} onClick={() => call('action', { action: 'require_ip_allowlist', value: !a.require_ip_allowlist }, 'Saved.')} className="rounded-lg border border-gray-300 px-3 py-2 font-semibold">
                  {a.require_ip_allowlist ? 'Stop requiring IP allowlists' : 'Require IP allowlists'}
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(['daily_out_ngn', 'daily_out_usd', 'max_float_ngn', 'max_float_usd'] as const).map((k) => (
                  <label key={k} className="text-sm text-gray-700">
                    {k === 'daily_out_ngn' ? 'Daily outflow ₦' : k === 'daily_out_usd' ? 'Daily outflow $' : k === 'max_float_ngn' ? 'Max balance ₦' : 'Max balance $'}
                    <input value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value.replace(/[^\d.]/g, '') })} className={input} placeholder="default" />
                  </label>
                ))}
              </div>
              <button disabled={busy} onClick={() => call('action', { action: 'set_limits', ...limitBody }, 'Limits saved.')} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                Save limits
              </button>
            </section>
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Recent live money</h2>
            {d.recent_live_transactions.length === 0 ? (
              <p className="text-sm text-gray-500">None yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {d.recent_live_transactions.map((t) => (
                    <tr key={t.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 text-gray-500">{new Date(t.created_at).toLocaleString()}</td>
                      <td className="py-2">{t.description ?? t.kind}</td>
                      <td className="py-2">{t.status}</td>
                      <td className="py-2 text-right font-medium">{money(t.amount, t.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Security log</h2>
            <ul className="space-y-1 text-sm">
              {d.audit.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-x-3">
                  <span className="text-gray-500">{new Date(e.created_at).toLocaleString()}</span>
                  <span className="font-medium">{e.action}</span>
                  <span className="text-gray-500">{e.actor}</span>
                  {e.ip && <span className="text-gray-400">{e.ip}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </DashboardLayout>
  );
}
