'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Ticket } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Kind = 'percent' | 'fixed';

interface Code {
  id: string;
  code: string;
  kind: Kind;
  value: string;
  valueLabel: string;
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  minSubtotalMinor: string | null;
  minSubtotalFormatted: string | null;
}

interface Draft {
  code: string;
  kind: Kind;
  value: string;
  maxRedemptions: string;
  minSubtotal: string;
  expiresAt: string; // yyyy-mm-dd
}

const EMPTY: Draft = { code: '', kind: 'percent', value: '', maxRedemptions: '', minSubtotal: '', expiresAt: '' };

const INPUT =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none';

export default function DiscountCodesPage() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/gadgets/discounts', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setCodes(data.codes);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    setBusy('create');
    setMessage(null);
    try {
      const res = await fetch('/api/gadgets/discounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: draft.code.trim(),
          kind: draft.kind,
          value: draft.value.trim(),
          maxRedemptions: draft.maxRedemptions.trim() === '' ? null : Number(draft.maxRedemptions),
          minSubtotal: draft.minSubtotal.trim() === '' ? null : draft.minSubtotal.trim(),
          expiresAt: draft.expiresAt ? new Date(draft.expiresAt + 'T23:59:59').toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not create the code');
      setDraft(EMPTY);
      setCreating(false);
      setMessage({ kind: 'ok', text: 'Discount code created.' });
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not create' });
    } finally {
      setBusy(null);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/gadgets/discounts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not update');
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not update' });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string, code: string) {
    if (!confirm(`Delete code ${code}? Existing orders keep their discount.`)) return;
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/gadgets/discounts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not delete');
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not delete' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Discount Codes</h1>
          <p className="mt-2 text-gray-600">
            Promo codes customers can apply at gadget checkout. Percent or a fixed amount off.
          </p>
        </div>
        <button
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700"
        >
          <Plus size={18} /> New code
        </button>
      </div>

      {message && (
        <div
          className={
            'mb-4 rounded-lg border p-3 text-sm ' +
            (message.kind === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {message.text}
        </div>
      )}

      {creating && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 font-semibold text-gray-900">New discount code</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input className={INPUT} placeholder="Code (e.g. SAVE10)" value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
            <select className={INPUT} value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}>
              <option value="percent">Percent off (%)</option>
              <option value="fixed">Fixed amount off (₦)</option>
            </select>
            <input className={INPUT}
              placeholder={draft.kind === 'percent' ? 'Percent, e.g. 10' : 'Amount in ₦, e.g. 5000'}
              inputMode="decimal" value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
            <input className={INPUT} placeholder="Max uses (blank = unlimited)" inputMode="numeric"
              value={draft.maxRedemptions}
              onChange={(e) => setDraft({ ...draft, maxRedemptions: e.target.value.replace(/\D/g, '') })} />
            <input className={INPUT} placeholder="Min order ₦ (optional)" inputMode="decimal"
              value={draft.minSubtotal}
              onChange={(e) => setDraft({ ...draft, minSubtotal: e.target.value })} />
            <div>
              <label className="mb-1 block text-xs text-gray-500">Expires (optional)</label>
              <input className={INPUT} type="date" value={draft.expiresAt}
                onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={create}
              disabled={busy === 'create' || !draft.code.trim() || !draft.value.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy === 'create' && <Loader2 size={16} className="animate-spin" />} Create
            </button>
            <button onClick={() => { setCreating(false); setDraft(EMPTY); }}
              className="rounded-lg px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : codes.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          <Ticket className="mx-auto mb-3 text-gray-300" size={40} />
          No discount codes yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Limits</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {codes.map((c) => {
                const expired = c.expiresAt ? new Date(c.expiresAt) < new Date() : false;
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">{c.code}</td>
                    <td className="px-4 py-3 text-gray-700">{c.valueLabel}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {c.redemptions}{c.maxRedemptions !== null ? ` / ${c.maxRedemptions}` : ''}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {c.minSubtotalFormatted ? <div>min {c.minSubtotalFormatted}</div> : null}
                      {c.expiresAt ? <div>exp {new Date(c.expiresAt).toLocaleDateString('en-NG')}</div> : null}
                      {!c.minSubtotalFormatted && !c.expiresAt ? '—' : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={'rounded-full px-2 py-1 text-xs font-semibold ' +
                        (c.active && !expired ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                        {expired ? 'Expired' : c.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          disabled={busy === c.id}
                          onClick={() => patch(c.id, { active: !c.active })}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {c.active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          disabled={busy === c.id}
                          onClick={() => remove(c.id, c.code)}
                          className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-50"
                          aria-label="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}
