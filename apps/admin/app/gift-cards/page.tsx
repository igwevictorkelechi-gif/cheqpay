'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Gift, Loader2, X } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Status = 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

interface Trade {
  id: string;
  brandName: string;
  countryName: string;
  cardType: 'PHYSICAL' | 'ECODE';
  faceValueFormatted: string;
  rateFormatted: string;
  payoutFormatted: string;
  status: Status;
  rejectReason: string | null;
  hasCode: boolean;
  photos: number;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  kycTier: number;
  priorApproved: number;
  priorRejected: number;
  claimedBy: string | null;
  reviewedBy: string | null;
}
interface Detail extends Trade {
  code: string | null;
  pin: string | null;
  photoUrls: string[];
}

const STATUS_STYLE: Record<Status, string> = {
  SUBMITTED: 'bg-purple-100 text-purple-700',
  IN_REVIEW: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};
const STATUS_LABEL: Record<Status, string> = { SUBMITTED: 'New', IN_REVIEW: 'Reviewing', APPROVED: 'Paid', REJECTED: 'Rejected' };

const FILTERS = [
  { key: 'OPEN', label: 'To review' },
  { key: 'APPROVED', label: 'Paid' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
] as const;

const REASONS = [
  'The card has already been used.',
  'The code is invalid.',
  "The photo isn't clear enough to read the code.",
  "The card country or type doesn't match what you selected.",
  "The card value doesn't match what you entered.",
  'We need a receipt for this card.',
];

/**
 * Gift card trade-ins waiting for review. Open a trade to see the code and
 * photos, check the card, then approve (pays the locked amount into the user's
 * Naira balance — needs your authenticator code) or reject with a reason.
 */
export default function GiftCardTradesPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('OPEN');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [open, setOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/giftcards/trades?status=${filter}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setTrades(data.trades);
      setOpen(data.open);
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

  async function openTrade(t: Trade) {
    setDetail(null);
    setReason('');
    setDetailLoading(true);
    setMessage(null);
    try {
      // Claim it first, so a colleague sees it's being handled.
      if (t.status === 'SUBMITTED') {
        await fetch(`/api/giftcards/trades/${t.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'claim' }),
        });
      }
      const res = await fetch(`/api/giftcards/trades/${t.id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to open');
      setDetail(data.trade);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to open' });
    } finally {
      setDetailLoading(false);
    }
  }

  async function act(action: 'approve' | 'reject') {
    if (!detail) return;
    if (action === 'approve' && !confirm(`Pay ${detail.payoutFormatted} to ${detail.userEmail ?? 'this user'}?`)) return;
    if (action === 'reject' && reason.trim().length < 5) {
      setMessage({ kind: 'err', text: 'Pick or write a reason the user will see.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/giftcards/trades/${detail.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { action } : { action, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setMessage({
        kind: 'ok',
        text: action === 'approve' ? `Approved — ${detail.payoutFormatted} paid to the user.` : 'Rejected — the user has been told why.',
      });
      setDetail(null);
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  const reviewable = detail && (detail.status === 'SUBMITTED' || detail.status === 'IN_REVIEW');

  return (
    <DashboardLayout>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gift card trades</h1>
          <p className="mt-2 text-gray-600">Check each card, then approve to pay the user or reject with a reason.</p>
        </div>
        <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800">{open} waiting</span>
      </div>

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === f.key ? 'bg-brand-600 text-white' : 'bg-white text-gray-700 border border-gray-200'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {message && (
        <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_440px]">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : trades.length === 0 ? (
            <div className="py-16 text-center text-gray-500">
              <Gift className="mx-auto mb-2 h-8 w-8" />
              Nothing here.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Card</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Payout</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => openTrade(t)}
                    className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${detail?.id === t.id ? 'bg-brand-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{t.brandName} · {t.faceValueFormatted}</p>
                      <p className="text-xs text-gray-500">{t.countryName} · {t.cardType === 'ECODE' ? 'E-code' : 'Physical'} · {t.photos} photo{t.photos === 1 ? '' : 's'}{t.hasCode ? ' · code' : ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{t.userEmail}</p>
                      <p className="text-xs text-gray-500">KYC {t.kycTier} · {t.priorApproved} paid / {t.priorRejected} rejected before</p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{t.payoutFormatted}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                      {t.claimedBy && t.status === 'IN_REVIEW' && <p className="mt-1 text-xs text-gray-500">{t.claimedBy}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          {detailLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : !detail ? (
            <p className="py-16 text-center text-sm text-gray-500">Select a trade to review it.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-lg font-bold text-gray-900">{detail.brandName} · {detail.faceValueFormatted}</p>
                  <p className="text-sm text-gray-500">{detail.countryName} · {detail.cardType === 'ECODE' ? 'E-code' : 'Physical card'}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[detail.status]}`}>{STATUS_LABEL[detail.status]}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-sm">
                <div><p className="text-gray-500">Rate (locked)</p><p className="font-semibold">{detail.rateFormatted}/unit</p></div>
                <div><p className="text-gray-500">Pays</p><p className="text-lg font-bold text-gray-900">{detail.payoutFormatted}</p></div>
                <div className="col-span-2"><p className="text-gray-500">User</p><p className="font-semibold">{detail.userName ?? '—'} · {detail.userEmail}</p></div>
              </div>

              {(detail.code || detail.pin) && (
                <div className="rounded-lg border border-gray-200 p-3">
                  {detail.code && (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500">Code</p>
                        <p className="font-mono text-base font-semibold tracking-wide">{detail.code}</p>
                      </div>
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(detail.code ?? '');
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                        className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
                        aria-label="Copy code"
                      >
                        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  )}
                  {detail.pin && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-500">PIN</p>
                      <p className="font-mono font-semibold">{detail.pin}</p>
                    </div>
                  )}
                </div>
              )}

              {detail.photoUrls.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {detail.photoUrls.map((u, i) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-gray-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`Card photo ${i + 1}`} className="h-36 w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              {detail.note && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">User note: {detail.note}</p>}

              {detail.status === 'REJECTED' && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Rejected: {detail.rejectReason}</p>}
              {detail.reviewedBy && <p className="text-xs text-gray-500">Reviewed by {detail.reviewedBy}{detail.reviewedAt ? ` · ${new Date(detail.reviewedAt).toLocaleString()}` : ''}</p>}

              {reviewable && (
                <>
                  <button
                    onClick={() => act('approve')}
                    disabled={busy}
                    className="w-full rounded-lg bg-green-600 py-3 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {busy ? 'Working…' : `Approve & pay ${detail.payoutFormatted}`}
                  </button>
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <p className="text-sm font-semibold text-gray-700">Reject</p>
                    <select value="" onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                      <option value="">Pick a reason…</option>
                      {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="The user sees this."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => act('reject')}
                      disabled={busy}
                      className="flex w-full items-center justify-center gap-1 rounded-lg border border-red-300 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" /> Reject card
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
