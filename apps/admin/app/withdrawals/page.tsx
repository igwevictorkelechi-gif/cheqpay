'use client';

import React, { useCallback, useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Banknote, CheckCircle2, Coins, RefreshCw, XCircle } from 'lucide-react';

type Withdrawal = {
  id: string;
  userId: string;
  email: string;
  asset: string;
  network: string | null;
  amountFormatted: string;
  metadata: {
    toAddress?: string;
    bankCode?: string;
    accountNumber?: string;
    accountName?: string;
    bankName?: string;
    manualPayout?: boolean;
    amlFlags?: string[];
  } | null;
  createdAt: string;
};

export default function WithdrawalsPage() {
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/withdrawals', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load withdrawals (' + res.status + ')');
      const d = await res.json();
      setRows(Array.isArray(d.withdrawals) ? d.withdrawals : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(w: Withdrawal, action: 'approve' | 'reject') {
    const isManualCrypto = w.asset !== 'NGN';
    const txHash = (txHashes[w.id] ?? '').trim();
    if (action === 'approve' && isManualCrypto && w.metadata?.manualPayout && !txHash) {
      if (!window.confirm('No transaction hash entered. Approve anyway? You can add the hash later from the block explorer.')) {
        return;
      }
    }
    if (action === 'reject' && !window.confirm('Reject and refund this withdrawal to the user?')) {
      return;
    }
    setActing(w.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transactionId: w.id,
          action,
          ...(action === 'approve' && txHash ? { txHash } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Action failed (' + res.status + ')');
      setNotice(
        action === 'approve'
          ? `Approved — ${w.amountFormatted} ${w.asset} for ${w.email} is on its way.`
          : `Rejected — ${w.amountFormatted} ${w.asset} refunded to ${w.email}.`
      );
      setRows((r) => r.filter((x) => x.id !== w.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActing(null);
    }
  }

  function destination(w: Withdrawal): string {
    const m = w.metadata ?? {};
    if (w.asset === 'NGN') {
      return [m.accountName, m.accountNumber, m.bankName ?? m.bankCode]
        .filter(Boolean)
        .join(' · ') || '—';
    }
    return m.toAddress ?? '—';
  }

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Withdrawals Review</h1>
          <p className="text-gray-600 mt-2">
            Approve or reject held payouts. Crypto payouts are sent manually from the business
            wallet — paste the on-chain hash when approving so it appears on the user&apos;s receipt.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{notice}</div>
      )}

      {loading && rows.length === 0 && <p className="text-gray-500">Loading…</p>}

      {!loading && rows.length === 0 && !error && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
          <p className="text-lg font-semibold text-gray-900">All clear</p>
          <p className="text-gray-500 mt-1">No withdrawals are waiting for review.</p>
        </div>
      )}

      <div className="space-y-4">
        {rows.map((w) => {
          const isNgn = w.asset === 'NGN';
          const flags = w.metadata?.amlFlags ?? [];
          return (
            <div key={w.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={'p-2.5 rounded-lg ' + (isNgn ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600')}>
                    {isNgn ? <Banknote size={20} /> : <Coins size={20} />}
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-900">
                      {w.amountFormatted} {w.asset}
                      {w.network && w.network !== 'FIAT' && (
                        <span className="ml-2 text-xs font-medium text-gray-500">{w.network}</span>
                      )}
                    </p>
                    <p className="text-sm text-gray-600 mt-0.5">{w.email}</p>
                    <p className="text-sm text-gray-500 mt-1 break-all">
                      <span className="font-medium text-gray-700">To:</span> {destination(w)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Requested {new Date(w.createdAt).toLocaleString()}
                    </p>
                    {flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {flags.map((f) => (
                          <span key={f} className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 w-full sm:w-auto sm:min-w-[320px]">
                  {!isNgn && (
                    <input
                      value={txHashes[w.id] ?? ''}
                      onChange={(e) => setTxHashes((s) => ({ ...s, [w.id]: e.target.value }))}
                      placeholder="On-chain transaction hash (after sending)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => review(w, 'approve')}
                      disabled={acting === w.id}
                      className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                    >
                      <CheckCircle2 size={16} /> {acting === w.id ? 'Working…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => review(w, 'reject')}
                      disabled={acting === w.id}
                      className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-semibold hover:bg-red-100 disabled:opacity-50"
                    >
                      <XCircle size={16} /> Reject &amp; refund
                    </button>
                  </div>
                  {!isNgn && (
                    <p className="text-xs text-gray-400">
                      Send the funds from the business wallet first, then approve with the hash.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </DashboardLayout>
  );
}
