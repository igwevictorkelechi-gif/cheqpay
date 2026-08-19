'use client';

import { useState } from 'react';
import { Search, ShieldAlert, Loader2, Eye } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

/**
 * Compliance subject lookup — the screen used when authorities ask about an
 * account, or when investigating suspected fraud.
 *
 * Searches open AND closed accounts. A closed account is often the one being
 * asked about, and its identity is retained for five years as Nigerian AML law
 * requires (the live profile is scrubbed; see apps/api/src/lib/retention.ts).
 *
 * The full BVN is hidden by default and fetched only on an explicit click,
 * which the backend records as a separate audit action. Confirming a match
 * needs the last four; producing the whole number is a weightier act.
 */

type Txn = {
  id: string; type: string; asset: string; amount: string; fee: string;
  status: string; externalRef: string | null; txHash: string | null; createdAt: string;
};
type Subject = {
  userId: string;
  status: string;
  identity: {
    legalName: string | null; email: string; phone: string | null;
    username: string | null; dateOfBirth: string | null;
    bvnLast4: string | null; bvn: string | null; kycTier: number;
  };
  retention: { closedAt: string; retainUntil: string; reason: string } | null;
  kycRecords: { id: string; tier: number; status: string; createdAt: string }[];
  transactionCount: number;
  transactions: Txn[];
  auditTrail: { action: string; createdAt: string; ipAddress: string | null }[];
};

export default function CompliancePage() {
  const [q, setQ] = useState('');
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (reveal = false) => {
    if (q.trim().length < 3) { setError('Enter at least 3 characters.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `/api/subject-lookup?q=${encodeURIComponent(q.trim())}${reveal ? '&reveal=true' : ''}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Lookup failed');
      setSubjects(data.subjects ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
      setSubjects(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold text-slate-900">Compliance Lookup</h1>
        <p className="mt-1 text-sm text-slate-500">
          Find a subject by BVN, legal name, phone, email, username, or transaction
          reference. Closed accounts are included. Every search is logged against your
          admin account.
        </p>

        <div className="mt-6 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search(false)}
              placeholder="22123456789 · Ada Okeke · 08012345678 · TXN reference"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <button
            onClick={() => search(false)}
            disabled={loading}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {subjects?.length === 0 && (
          <p className="mt-8 text-center text-sm text-slate-500">No subject matches that.</p>
        )}

        {subjects?.map((s) => (
          <section key={s.userId} className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {s.identity.legalName ?? '(no legal name on record)'}
                </h2>
                <p className="mt-0.5 font-mono text-xs text-slate-400">{s.userId}</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  s.status === 'CLOSED'
                    ? 'bg-slate-100 text-slate-600'
                    : s.status === 'ACTIVE'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                }`}
              >
                {s.status}
              </span>
            </div>

            {s.retention && (
              <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                Account closed {new Date(s.retention.closedAt).toLocaleDateString()}. Identity and
                transaction history retained until{' '}
                <strong>{new Date(s.retention.retainUntil).toLocaleDateString()}</strong> under
                Nigerian AML record-keeping requirements.
              </p>
            )}

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              <Field label="Email" value={s.identity.email} />
              <Field label="Phone" value={s.identity.phone} />
              <Field label="Username" value={s.identity.username} />
              <Field label="Date of birth" value={s.identity.dateOfBirth} />
              <Field label="KYC tier" value={String(s.identity.kycTier)} />
              <div>
                <dt className="text-xs text-slate-400">BVN</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {s.identity.bvn ? (
                    <span className="font-mono">{s.identity.bvn}</span>
                  ) : s.identity.bvnLast4 ? (
                    <button
                      onClick={() => search(true)}
                      className="inline-flex items-center gap-1 text-slate-700 underline decoration-dotted"
                      title="Reveals the full BVN. This action is recorded in the audit log."
                    >
                      <Eye className="h-3.5 w-3.5" />
                      •••••••{s.identity.bvnLast4}
                    </button>
                  ) : (
                    <span className="text-slate-400">not on record</span>
                  )}
                </dd>
              </div>
            </dl>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">
              Transactions ({s.transactionCount})
            </h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="py-1.5">Date</th><th>Type</th><th>Asset</th>
                    <th className="text-right">Amount</th><th>Status</th><th>Reference</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {s.transactions.slice(0, 50).map((t) => (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="py-1.5">{new Date(t.createdAt).toLocaleString()}</td>
                      <td>{t.type}</td>
                      <td>{t.asset}</td>
                      <td className="text-right font-mono">{t.amount}</td>
                      <td>{t.status}</td>
                      <td className="font-mono text-[11px] text-slate-400">
                        {t.externalRef ?? t.txHash ?? t.id.slice(0, 8)}
                      </td>
                    </tr>
                  ))}
                  {s.transactions.length === 0 && (
                    <tr><td colSpan={6} className="py-3 text-slate-400">No transactions.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">Recent activity</h3>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {s.auditTrail.slice(0, 15).map((a, i) => (
                <li key={i} className="flex justify-between gap-4 border-t border-slate-100 py-1">
                  <span className="font-mono">{a.action}</span>
                  <span className="text-slate-400">
                    {new Date(a.createdAt).toLocaleString()}
                    {a.ipAddress ? ` · ${a.ipAddress}` : ''}
                  </span>
                </li>
              ))}
              {s.auditTrail.length === 0 && <li className="text-slate-400">No recorded activity.</li>}
            </ul>
          </section>
        ))}
      </div>
    </DashboardLayout>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">
        {value ?? <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}
