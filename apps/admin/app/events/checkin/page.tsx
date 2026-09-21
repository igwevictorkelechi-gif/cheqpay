'use client';

import { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, ScanLine } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Result { ok: boolean; text: string; sub?: string }

export default function CheckInPage() {
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function checkIn(e?: React.FormEvent) {
    e?.preventDefault();
    const ref = reference.trim();
    if (!ref) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/events/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reference: ref }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, text: data.error ?? 'Not valid' });
      } else {
        setResult({ ok: true, text: 'Admitted', sub: `${data.result.eventTitle} · ${data.result.tierName}` });
      }
    } catch {
      setResult({ ok: false, text: 'Network error — try again' });
    } finally {
      setBusy(false);
      setReference('');
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-lg">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Ticket Check-in</h1>
          <p className="mt-2 text-gray-600">
            Scan the ticket QR with your phone camera and type or paste the code, or enter the reference by hand.
            Each code admits once.
          </p>
        </div>

        <form onSubmit={checkIn} className="rounded-xl border border-gray-200 bg-white p-5">
          <label className="mb-1 block text-sm font-medium text-gray-700">Ticket reference</label>
          <div className="flex gap-2">
            <input
              autoFocus
              value={reference}
              onChange={(e) => setReference(e.target.value.toUpperCase())}
              placeholder="CHQ-XXXXX-XXXXX"
              className="w-full rounded-lg border border-gray-300 px-3 py-3 font-mono text-lg tracking-wide focus:border-brand-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !reference.trim()}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ScanLine size={18} />} Check in
            </button>
          </div>
        </form>

        {result && (
          <div
            className={
              'mt-4 flex items-center gap-3 rounded-xl border p-5 ' +
              (result.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')
            }
          >
            {result.ok ? <CheckCircle2 className="text-green-600" size={32} /> : <XCircle className="text-red-600" size={32} />}
            <div>
              <div className={'text-lg font-bold ' + (result.ok ? 'text-green-800' : 'text-red-800')}>{result.text}</div>
              {result.sub && <div className="text-sm text-gray-600">{result.sub}</div>}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
