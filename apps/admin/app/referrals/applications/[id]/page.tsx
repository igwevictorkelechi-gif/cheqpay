'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import { STATUS_STYLE, followers, platformName, type ApplicationSummary } from '../shared';

interface Detail {
  application: ApplicationSummary & { kycTierAtApply: number | null; legalNameAtApply: string | null; termsAcceptedAt: string | null };
  vetting: {
    userId: string;
    email: string;
    username: string | null;
    phone: string | null;
    kycTier: number;
    legalName: string | null;
    accountStatus: string;
    accountCreatedAt: string;
    accountAgeDays: number;
    completedTransactions: number;
    bvnSharedWith: number;
    referredBy: string | null;
    referrals: { signedUp: number; qualified: number };
    phoneMatches: { id: string; email: string; status: string }[];
  };
  defaults: { commissionPercent: number; windowDays: number | null };
}

type Tab = 'approve' | 'request_info' | 'reject';

/**
 * One creator application: what they told us, what CheqPay already knows about
 * them, and the decision. Approving asks for your authenticator code.
 */
export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('approve');
  const [form, setForm] = useState({ code: '', percent: '', window: '', note: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/referrals/applications/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setD(data);
      const a: Detail['application'] = data.application;
      setForm({
        code: (a.preferredCode ?? a.fullName.split(' ')[0] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
        percent: String(data.defaults.commissionPercent),
        window: data.defaults.windowDays === null ? '' : String(data.defaults.windowDays),
        note: '',
        reason: '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  async function decide() {
    if (!d) return;
    setBusy(true);
    setError(null);
    try {
      const body =
        tab === 'approve'
          ? { action: 'approve', code: form.code, commissionPercent: Number(form.percent), windowDays: form.window ? Number(form.window) : null }
          : tab === 'request_info'
            ? { action: 'request_info', note: form.note }
            : { action: 'reject', reason: form.reason };
      const res = await fetch(`/api/referrals/applications/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setDone(
        tab === 'approve'
          ? `${d.application.fullName} is now a creator with code ${form.code}.`
          : tab === 'request_info'
            ? 'Sent. The application waits on the creator until they update it.'
            : 'Rejected. They can apply again in 30 days.',
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const input = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  if (!d) {
    return (
      <DashboardLayout>
        <Back />
        {error ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}
      </DashboardLayout>
    );
  }

  const a = d.application;
  const v = d.vetting;
  const open = a.status === 'PENDING' || a.status === 'NEEDS_INFO';
  const nameMismatch = !!v.legalName && a.fullName.trim().toUpperCase() !== v.legalName.trim().toUpperCase();

  const flags: { level: 'bad' | 'warn'; text: string }[] = [];
  if (v.accountStatus !== 'ACTIVE') flags.push({ level: 'bad', text: `Account is ${v.accountStatus.toLowerCase()}.` });
  if (v.kycTier < 1) flags.push({ level: 'bad', text: 'Identity not verified.' });
  if (v.bvnSharedWith > 0) flags.push({ level: 'bad', text: `BVN is on ${v.bvnSharedWith} other account${v.bvnSharedWith > 1 ? 's' : ''}.` });
  if (v.phoneMatches.length) flags.push({ level: 'warn', text: `Phone number matches ${v.phoneMatches.length} other application${v.phoneMatches.length > 1 ? 's' : ''}.` });
  if (nameMismatch) flags.push({ level: 'warn', text: 'Name on the application differs from the verified legal name.' });
  if (v.accountAgeDays < 7) flags.push({ level: 'warn', text: `Account is only ${v.accountAgeDays} day${v.accountAgeDays === 1 ? '' : 's'} old.` });

  return (
    <DashboardLayout>
      <Back />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{a.fullName}</h1>
          <p className="mt-1 text-gray-600">{v.email}{v.username ? ` · @${v.username}` : ''}</p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${STATUS_STYLE[a.status]}`}>{a.status.replace('_', ' ')}</span>
      </div>

      {done && <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{done}</p>}
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="Platforms">
            <ul className="divide-y divide-gray-100">
              {a.socials.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-gray-900">{platformName(s.platform)} · @{s.handle}</p>
                    <p className="text-sm text-gray-500">{followers(s.followers)} followers</p>
                  </div>
                  {s.url && <ExtLink href={s.url}>Open profile</ExtLink>}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Audience and content">
            <Facts rows={[
              ['Topics', a.niches.join(', ') || '—'],
              ['Audience mostly in', a.audienceLocation || '—'],
              ['Typical views per post', a.avgViews ? followers(a.avgViews) : '—'],
            ]} />
            {a.sampleLinks.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-gray-500">Recent posts</p>
                <ul className="mt-1 space-y-1">
                  {a.sampleLinks.map((l) => (
                    <li key={l}><ExtLink href={l}>{l.replace(/^https:\/\/(www\.)?/, '')}</ExtLink></li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card title="Background">
            <Facts rows={[
              ['About', a.bio || '—'],
              ['Brands worked with', a.priorBrands || '—'],
              ['Why CheqPay', a.why || '—'],
              ['Preferred code', a.preferredCode ?? '—'],
              ['Phone', a.phone],
            ]} />
          </Card>

          <Card title="History">
            <Facts rows={[
              ['First applied', new Date(a.createdAt).toLocaleString()],
              ['Last sent', `${new Date(a.updatedAt).toLocaleString()}${a.submissions > 1 ? ` (${a.submissions} times)` : ''}`],
              ['Agreed to Creator terms', a.termsAcceptedAt ? new Date(a.termsAcceptedAt).toLocaleString() : '— (older form)'],
              ...(a.reviewedBy ? [['Last reviewed by', `${a.reviewedBy}${a.reviewedAt ? `, ${new Date(a.reviewedAt).toLocaleString()}` : ''}`] as [string, string]] : []),
              ...(a.requestNote ? [['We asked', a.requestNote] as [string, string]] : []),
              ...(a.reason ? [['Rejected because', a.reason] as [string, string]] : []),
            ]} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Vetting">
            {flags.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800"><CheckCircle2 className="h-4 w-4" /> No red flags found.</p>
            ) : (
              <ul className="space-y-2">
                {flags.map((f) => (
                  <li key={f.text} className={`flex gap-2 rounded-lg px-3 py-2 text-sm ${f.level === 'bad' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {f.text}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Facts rows={[
                ['Verified legal name', v.legalName ?? '—'],
                ['KYC tier', `${v.kycTier}${a.kycTierAtApply !== null && a.kycTierAtApply !== v.kycTier ? ` (was ${a.kycTierAtApply} when applying)` : ''}`],
                ['Account', `${v.accountStatus.toLowerCase()}, ${v.accountAgeDays} days old`],
                ['Completed transactions', String(v.completedTransactions)],
                ['Referred by', v.referredBy ?? '—'],
                ['People they referred', `${v.referrals.signedUp} signed up, ${v.referrals.qualified} qualified`],
                ['Same BVN on other accounts', String(v.bvnSharedWith)],
              ]} />
            </div>
            {v.phoneMatches.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-gray-500">Other applications with this phone</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {v.phoneMatches.map((m) => (
                    <li key={m.id}><Link href={`/referrals/applications/${m.id}`} className="text-brand-700 hover:underline">{m.email}</Link> <span className="text-gray-500">· {m.status}</span></li>
                  ))}
                </ul>
              </div>
            )}
            <Link href={`/users/${v.userId}`} className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">Open user profile →</Link>
          </Card>

          {open && (
            <Card title="Decision">
              <div className="mb-4 grid grid-cols-3 rounded-lg bg-gray-100 p-1 text-sm font-semibold">
                {(['approve', 'request_info', 'reject'] as Tab[]).filter((t) => t !== 'request_info' || a.status === 'PENDING').map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`rounded-md py-1.5 ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}>
                    {t === 'approve' ? 'Approve' : t === 'request_info' ? 'Ask for more' : 'Reject'}
                  </button>
                ))}
              </div>
              {tab === 'approve' && (
                <div className="space-y-3">
                  <label className="block text-xs text-gray-600">Creator code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) })} className={`${input} mt-1 w-full font-mono`} /></label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs text-gray-600">% of our fee<input value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value.replace(/[^\d.]/g, '') })} className={`${input} mt-1 w-full`} /></label>
                    <label className="block text-xs text-gray-600">Days (blank = forever)<input value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value.replace(/\D/g, '') })} className={`${input} mt-1 w-full`} /></label>
                  </div>
                  <button onClick={decide} disabled={busy || form.code.length < 4 || !form.percent} className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                    {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Approve as creator'}
                  </button>
                  <p className="text-xs text-gray-500">Asks for your authenticator code.</p>
                </div>
              )}
              {tab === 'request_info' && (
                <div className="space-y-3">
                  <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={4} maxLength={500} placeholder="What do you need? The creator sees this and can update their application." className={`${input} w-full`} />
                  <button onClick={decide} disabled={busy || form.note.trim().length < 3} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                    {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Send request'}
                  </button>
                </div>
              )}
              {tab === 'reject' && (
                <div className="space-y-3">
                  <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} maxLength={300} placeholder="The applicant sees this." className={`${input} w-full`} />
                  <button onClick={decide} disabled={busy || form.reason.trim().length < 3} className="w-full rounded-lg border border-red-300 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-40">
                    {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Reject'}
                  </button>
                  <p className="text-xs text-gray-500">They can apply again after 30 days.</p>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Back() {
  return (
    <Link href="/referrals" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-gray-600 hover:text-gray-900">
      <ArrowLeft className="h-4 w-4" /> Applications
    </Link>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([k, val]) => (
        <div key={k} className="grid grid-cols-[160px_1fr] gap-3">
          <dt className="text-gray-500">{k}</dt>
          <dd className="whitespace-pre-wrap break-words text-gray-900">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Links come from applicants: only ever open https, in a new tab, with no referrer. */
function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (!/^https:\/\//i.test(href)) return <span className="text-sm text-gray-500">{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
      {children} <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}
