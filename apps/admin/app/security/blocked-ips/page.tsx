'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, Loader2, LogOut, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface BlockedIp {
  ip: string;
  reason: string;
  sourceUserId: string | null;
  createdBy: string;
  createdAt: string;
}

export default function BlockedIpsPage() {
  const [rows, setRows] = useState<BlockedIp[] | null>(null);
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/blocked-ips', { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMessage({ kind: 'err', text: d.error ?? `Failed to load (${r.status})` });
      setRows([]);
      return;
    }
    setRows(d.ips ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch('/api/blocked-ips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ip: ip.trim(), reason: reason.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not block that address');
      setIp('');
      setReason('');
      setMessage({ kind: 'ok', text: `${d.ip} is blocked. Requests from it are refused from now on.` });
      await load();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not block that address' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string) {
    setMessage(null);
    // Unblocking needs a Super Admin, a reason and an authenticator code; the
    // security prompt asks for the last two.
    const r = await fetch('/api/blocked-ips', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ip: target }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMessage({ kind: 'err', text: d.error ?? 'Could not unblock that address' });
      return;
    }
    setMessage({ kind: 'ok', text: `${target} unblocked.` });
    await load();
  }

  async function signOutEverywhere() {
    if (!window.confirm('Sign out every admin session, on every device — including this one?')) return;
    const r = await fetch('/api/sessions', { method: 'POST' });
    if (r.ok) {
      window.location.href = '/login';
      return;
    }
    const d = await r.json().catch(() => ({}));
    setMessage({ kind: 'err', text: d.error ?? 'Could not sign out sessions' });
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Blocked IPs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Requests from these addresses are refused on every part of the app, including new sign-ups.
            Blocking a user in User Management adds every address they have used here automatically.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-900">Something look wrong?</p>
            <p className="mt-0.5 text-sm text-red-800">
              Sign out every admin session at once. Anyone using a stolen session is locked out on their next click.
            </p>
          </div>
          <button
            onClick={signOutEverywhere}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            <LogOut size={16} /> Sign out everywhere
          </button>
        </div>

        <form onSubmit={add} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-[1fr_2fr_auto]">
          <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="IP address" className={inputCls} />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className={inputCls} />
          <button
            type="submit"
            disabled={busy || !ip.trim() || reason.trim().length < 3}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus size={16} />} Block
          </button>
        </form>

        {message && (
          <div
            className={
              'rounded-lg border p-3 text-sm ' +
              (message.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700')
            }
          >
            {message.text}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {rows === null ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-sm text-gray-500">
              <Ban className="mb-2 h-6 w-6 text-gray-300" /> No blocked addresses.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">Address</th>
                  <th className="px-4 py-2.5">Reason</th>
                  <th className="px-4 py-2.5">Blocked by</th>
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.ip}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-900">{r.ip}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {r.reason}
                      {r.sourceUserId ? (
                        <a href={`/users/${r.sourceUserId}`} className="ml-1 text-xs text-brand-600 hover:underline">
                          (account)
                        </a>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.createdBy}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => remove(r.ip)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-600"
                        title="Unblock (Super Admin, needs a reason and an authenticator code)"
                      >
                        <Trash2 size={14} /> Unblock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
