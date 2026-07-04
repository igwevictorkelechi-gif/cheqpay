'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Check, X, Clock } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';

interface KycRecord {
  id: string;
  tier: number;
  status: Status;
  documentRefs: string[];
  createdAt: string;
  reviewedAt: string | null;
  user: { id: string; email: string; phone: string; kycTier: number };
}

interface Payload {
  counts: { pending: number; approved: number; rejected: number };
  records: KycRecord[];
}

export default function KycPage() {
  const [status, setStatus] = useState<Status>('PENDING');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/kyc?status=${status}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setData(json);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(recordId: string, action: 'approve' | 'reject', tier?: number) {
    setBusy(recordId);
    setMessage(null);
    try {
      const res = await fetch('/api/kyc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordId, action, tier }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Action failed');
      setMessage({ kind: 'ok', text: `Submission ${action === 'approve' ? 'approved' : 'rejected'}.` });
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Action failed' });
    } finally {
      setBusy(null);
    }
  }

  const tabs: { key: Status; label: string; count?: number }[] = [
    { key: 'PENDING', label: 'Pending', count: data?.counts.pending },
    { key: 'APPROVED', label: 'Approved', count: data?.counts.approved },
    { key: 'REJECTED', label: 'Rejected', count: data?.counts.rejected },
  ];

  return (
    <DashboardLayout>
      <div className="mb-8 flex items-center gap-3">
        <ShieldCheck className="text-brand-600" size={26} />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">KYC Review</h1>
          <p className="text-gray-600 mt-1">
            Submissions auto-approve when the BVN check passes. Anything else lands here for manual
            authorization.
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mb-6 flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              status === t.key
                ? 'bg-brand-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                  status === t.key ? 'bg-white/25' : 'bg-gray-100'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : !data || data.records.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white py-16 text-gray-500">
          <Clock size={28} className="mb-3" />
          No {status.toLowerCase()} submissions.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Current tier</th>
                <th className="px-5 py-3">Requested</th>
                <th className="px-5 py-3">Submitted</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.records.map((r) => (
                <tr key={r.id} className="text-sm">
                  <td className="px-5 py-4">
                    <p className="font-medium text-gray-900">{r.user.email}</p>
                    <p className="text-gray-500">{r.user.phone}</p>
                  </td>
                  <td className="px-5 py-4 text-gray-700">Tier {r.user.kycTier}</td>
                  <td className="px-5 py-4 text-gray-700">Tier {r.tier}</td>
                  <td className="px-5 py-4 text-gray-500">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4">
                    {r.status === 'PENDING' ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => act(r.id, 'approve', 2)}
                          disabled={busy === r.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          <Check size={14} /> Approve
                        </button>
                        <button
                          onClick={() => act(r.id, 'reject')}
                          disabled={busy === r.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          <X size={14} /> Reject
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                          r.status === 'APPROVED'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {r.status}
                      </span>
                    )}
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
