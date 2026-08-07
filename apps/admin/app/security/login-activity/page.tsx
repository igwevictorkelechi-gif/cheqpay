'use client';

import { useEffect, useState } from 'react';
import { Loader2, Monitor, Smartphone, MapPin, ArrowLeft } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

/**
 * Login & Devices — where each account is being used from.
 *
 * The list answers "what has been happening lately"; clicking an account
 * answers "is this the same person who has always used it?". Multiple IPs in
 * different places over a short window is the shape account takeover makes.
 */

type Row = {
  id: string; email: string; username: string | null; legalName: string | null;
  status: string; lastSeenAt: string | null; lastIp: string | null;
  lastDevice: string | null; lastAction: string | null; deviceCount: number;
};
type Device = {
  id: string; ipAddress: string | null; device: string | null; platform: string;
  userAgent: string | null; hitCount: number; firstSeenAt: string; lastSeenAt: string;
};
type Detail = {
  user: (Row & { createdAt: string }) | null;
  devices: Device[];
  lastTransactions: { id: string; type: string; asset: string; amount: string; status: string; createdAt: string }[];
  recentActions: { action: string; ipAddress: string | null; createdAt: string }[];
};

export default function LoginActivityPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/security-activity', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? 'Failed to load');
        setRows(data.users ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const open = async (userId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/security-activity?userId=${userId}`, { cache: 'no-store' });
      setDetail(await res.json());
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl">
        {detail ? (
          <button
            onClick={() => setDetail(null)}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> All accounts
          </button>
        ) : null}

        <h1 className="text-2xl font-bold text-slate-900">Login &amp; Devices</h1>
        <p className="mt-1 text-sm text-slate-500">
          The IP address, device and last action recorded for each account. Addresses come
          from the proxy&apos;s forwarded-for header — good evidence, not proof of location.
        </p>

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}
        {loading && <Loader2 className="mt-8 h-5 w-5 animate-spin text-slate-400" />}

        {!loading && !detail && rows && (
          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3">Account</th>
                  <th>Last seen</th>
                  <th>IP</th>
                  <th>Device</th>
                  <th>Last action</th>
                  <th className="text-right">Devices</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => open(r.id)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {r.legalName ?? r.username ?? r.email}
                      </div>
                      <div className="text-xs text-slate-400">{r.email}</div>
                    </td>
                    <td className="text-xs text-slate-600">
                      {r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString() : '—'}
                    </td>
                    <td className="font-mono text-xs text-slate-600">{r.lastIp ?? '—'}</td>
                    <td className="text-xs text-slate-600">{r.lastDevice ?? '—'}</td>
                    <td className="font-mono text-[11px] text-slate-400">{r.lastAction ?? '—'}</td>
                    <td className="pr-4 text-right text-xs text-slate-600">{r.deviceCount}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-slate-400">
                    No activity recorded yet. Accounts appear here once they make a request.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && detail?.user && (
          <>
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-900">
                {detail.user.legalName ?? detail.user.username ?? detail.user.email}
              </h2>
              <p className="text-xs text-slate-400">{detail.user.email}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <F label="Status" v={detail.user.status} />
                <F label="Last IP" v={detail.user.lastIp} mono />
                <F label="Last device" v={detail.user.lastDevice} />
                <F label="Last action" v={detail.user.lastAction} mono />
              </dl>
            </section>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">
              Devices &amp; locations ({detail.devices.length})
            </h3>
            <div className="mt-2 space-y-2">
              {detail.devices.map((d) => (
                <div
                  key={d.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"
                >
                  {d.platform === 'mobile'
                    ? <Smartphone className="mt-0.5 h-4 w-4 text-slate-400" />
                    : <Monitor className="mt-0.5 h-4 w-4 text-slate-400" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {d.device ?? 'Unknown device'}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <MapPin className="h-3 w-3" />{d.ipAddress ?? 'no IP'}
                      </span>
                      <span>{d.hitCount} requests</span>
                      <span>first {new Date(d.firstSeenAt).toLocaleDateString()}</span>
                      <span>last {new Date(d.lastSeenAt).toLocaleString()}</span>
                    </div>
                    {d.userAgent && (
                      <p className="mt-1 truncate font-mono text-[10px] text-slate-300">
                        {d.userAgent}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {detail.devices.length === 0 && (
                <p className="text-sm text-slate-400">No devices recorded.</p>
              )}
            </div>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">Last transactions</h3>
            <ul className="mt-2 space-y-1 text-xs">
              {detail.lastTransactions.map((t) => (
                <li key={t.id} className="flex justify-between border-t border-slate-100 py-1.5">
                  <span className="text-slate-700">{t.type} · {t.asset} {t.amount}</span>
                  <span className="text-slate-400">
                    {t.status} · {new Date(t.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
              {detail.lastTransactions.length === 0 && (
                <li className="text-slate-400">No transactions.</li>
              )}
            </ul>

            <h3 className="mt-6 text-sm font-semibold text-slate-900">Recent actions</h3>
            <ul className="mt-2 space-y-1 text-xs">
              {detail.recentActions.map((a, i) => (
                <li key={i} className="flex justify-between border-t border-slate-100 py-1.5">
                  <span className="font-mono text-slate-700">{a.action}</span>
                  <span className="text-slate-400">
                    {a.ipAddress ? `${a.ipAddress} · ` : ''}
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
              {detail.recentActions.length === 0 && (
                <li className="text-slate-400">No recorded actions.</li>
              )}
            </ul>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function F({ label, v, mono }: { label: string; v: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className={`mt-0.5 font-medium text-slate-900 ${mono ? 'font-mono text-xs' : ''}`}>
        {v ?? <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}
