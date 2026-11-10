'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronLeft, Loader2, PiggyBank, Users, X } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

/**
 * Ajo for ops: what is locked in plans, which groups are running, who owes
 * whom and for how long. Read-only by design — the engine moves the money and
 * the lien collects arrears; this page is where support answers "where is my
 * money" and compliance watches for groups being used to cycle funds.
 */

interface Overview {
  plans: { active: number; matured: number; broken: number; savedNgn: string };
  groups: { forming: number; active: number; completed: number; cancelled: number; activePotNgn: string };
  arrears: { debtors: number; owedNgn: string; oldestSince: string | null };
  dueNext24h: { plans: number; groups: number };
}
interface Group {
  id: string; name: string; status: string; frequency: string; amount: string; pot: string; size: number; members: number;
  payoutOrder: string; currentRound: number; nextDueAt: string | null; startedAt: string | null; createdAt: string;
  owner: { email: string | null; username: string | null }; owed: string; behind: number;
}
interface GroupDetail {
  group: Group;
  members: { userId: string; email: string; username: string | null; kycTier: number; position: number | null; joinedAt: string; owed: string; missedRounds: number; paidRounds: number }[];
  rounds: { round: number; recipient: string | null; collected: string; paid: number; short: number; at: string }[];
}
interface Debtor {
  userId: string; email: string; username: string | null; accountStatus: string; owed: string; rounds: number; since: string; groups: string[]; walletNgn: string;
}
interface Plan {
  id: string; name: string; status: string; frequency: string; amount: string; saved: string; target: string; totalCount: number;
  paidCount: number; missedCount: number; nextDueAt: string | null; createdAt: string; closedAt: string | null; user: { email: string; username: string | null };
}

type Tab = 'groups' | 'debtors' | 'plans';
const GROUP_FILTERS = ['active', 'forming', 'arrears', 'completed', 'cancelled', 'all'] as const;
const PLAN_FILTERS = ['active', 'matured', 'broken', 'all'] as const;

const ngn = (v: string) => '₦' + Number(v).toLocaleString('en-NG', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);
const STATUS_CLS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  forming: 'bg-amber-100 text-amber-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-500',
  matured: 'bg-green-100 text-green-700',
  broken: 'bg-red-100 text-red-700',
};
const Pill = ({ s }: { s: string }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_CLS[s] ?? 'bg-gray-100 text-gray-600'}`}>{s}</span>
);

export default function AjoAdminPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-400" /></div>}>
        <AjoAdmin />
      </Suspense>
    </DashboardLayout>
  );
}

function AjoAdmin() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = ((params.get('tab') as Tab | null) ?? 'groups') as Tab;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ajo', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as Overview) : Promise.reject(await r.json().catch(() => ({})))))
      .then(setOverview)
      .catch((e: { error?: string }) => setError(e?.error ?? 'Couldn’t load the Ajo overview.'));
  }, []);

  const setTab = (t: Tab) => router.replace(t === 'groups' ? '/ajo' : `/ajo?tab=${t}`);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <PiggyBank className="text-brand-600" size={26} />
        <h1 className="text-2xl font-bold text-gray-900">Ajo savings</h1>
      </div>
      <p className="text-gray-500 text-sm mb-6">
        Read-only. Contributions are taken at 9am Lagos; arrears are swept from wallets within a minute of money arriving.
      </p>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Overview tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Tile label="Locked in plans" value={overview ? ngn(overview.plans.savedNgn) : '…'} sub={overview ? `${overview.plans.active} active plans · owed to customers` : ''} />
        <Tile label="Running groups" value={overview ? String(overview.groups.active) : '…'} sub={overview ? `${ngn(overview.groups.activePotNgn)} in pots per cycle · ${overview.groups.forming} forming` : ''} />
        <Tile
          label="In arrears"
          value={overview ? ngn(overview.arrears.owedNgn) : '…'}
          sub={overview ? `${overview.arrears.debtors} ${overview.arrears.debtors === 1 ? 'person' : 'people'}${overview.arrears.oldestSince ? ` · oldest ${daysSince(overview.arrears.oldestSince)}d` : ''}` : ''}
          warn={!!overview && overview.arrears.debtors > 0}
        />
        <Tile label="Due in 24h" value={overview ? `${overview.dueNext24h.groups} · ${overview.dueNext24h.plans}` : '…'} sub="group rounds · plan contributions" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(['groups', 'debtors', 'plans'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === t ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {t === 'groups' ? 'Groups' : t === 'debtors' ? 'Arrears' : 'Personal plans'}
          </button>
        ))}
      </div>

      {tab === 'groups' && <GroupsTab />}
      {tab === 'debtors' && <DebtorsTab />}
      {tab === 'plans' && <PlansTab />}
    </div>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border p-5 ${warn ? 'border-amber-300' : 'border-gray-200'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1">
        {warn && <AlertTriangle size={14} className="text-amber-500" />}
        {label}
      </p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function useList<T>(url: string, key: string): { rows: T[]; loading: boolean; error: string | null; reload: () => void } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    fetch(url, { cache: 'no-store' })
      .then(async (r) => (r.ok ? await r.json() : Promise.reject(await r.json().catch(() => ({})))))
      .then((d: Record<string, T[]>) => {
        setRows(d[key] ?? []);
        setError(null);
      })
      .catch((e: { error?: string }) => setError(e?.error ?? 'Couldn’t load.'))
      .finally(() => setLoading(false));
  }, [url, key]);
  useEffect(load, [load]);
  return { rows, loading, error, reload: load };
}

// ------------------------------------------------------------- groups --

function GroupsTab() {
  const [filter, setFilter] = useState<(typeof GROUP_FILTERS)[number]>('active');
  const { rows, loading, error } = useList<Group>(`/api/ajo/groups?status=${filter}`, 'groups');
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        {GROUP_FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize ${filter === f ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            {f === 'arrears' ? 'With arrears' : f}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="px-4 py-3 font-medium">Group</th>
              <th className="px-4 py-3 font-medium">Organiser</th>
              <th className="px-4 py-3 font-medium">Each · pot</th>
              <th className="px-4 py-3 font-medium">People</th>
              <th className="px-4 py-3 font-medium">Round</th>
              <th className="px-4 py-3 font-medium">Next due</th>
              <th className="px-4 py-3 font-medium">Arrears</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400"><Loader2 className="inline animate-spin" /></td></tr>
            )}
            {!loading && error && <tr><td colSpan={8} className="px-4 py-6 text-center text-red-600">{error}</td></tr>}
            {!loading && !error && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No groups here yet.</td></tr>
            )}
            {rows.map((g) => (
              <tr key={g.id} onClick={() => setOpenId(g.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-900">{g.name}</p>
                  <p className="text-xs text-gray-500">{g.frequency} · {g.payoutOrder === 'random' ? 'random draw' : 'join order'}</p>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <p>{g.owner.username ? `@${g.owner.username}` : '—'}</p>
                  <p className="text-xs text-gray-500">{g.owner.email}</p>
                </td>
                <td className="px-4 py-3 text-gray-700">{ngn(g.amount)} · <span className="font-semibold">{ngn(g.pot)}</span></td>
                <td className="px-4 py-3 text-gray-700"><Users size={14} className="inline mr-1 text-gray-400" />{g.members}/{g.size}</td>
                <td className="px-4 py-3 text-gray-700">{g.status === 'active' ? `${g.currentRound} of ${g.size}` : '—'}</td>
                <td className="px-4 py-3 text-gray-700">{g.status === 'active' ? when(g.nextDueAt) : '—'}</td>
                <td className="px-4 py-3">
                  {Number(g.owed) > 0 ? (
                    <span className="text-red-600 font-semibold">{ngn(g.owed)} <span className="text-xs font-normal">({g.behind} behind)</span></span>
                  ) : (
                    <span className="text-gray-400">none</span>
                  )}
                </td>
                <td className="px-4 py-3"><Pill s={g.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openId && <GroupDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function GroupDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    fetch(`/api/ajo/groups/${id}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as GroupDetail) : Promise.reject(await r.json().catch(() => ({})))))
      .then(setD)
      .catch((e: { error?: string }) => setError(e?.error ?? 'Couldn’t load this group.'));
  }, [id]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-2xl bg-white shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-5 border-b border-gray-100 sticky top-0 bg-white">
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900" aria-label="Close"><ChevronLeft /></button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">{d?.group.name ?? 'Group'}</h2>
            {d && <p className="text-xs text-gray-500">{ngn(d.group.amount)} each, every {d.group.frequency === 'daily' ? 'day' : d.group.frequency === 'weekly' ? 'week' : 'month'} · pot {ngn(d.group.pot)} · {d.group.members}/{d.group.size} people</p>}
          </div>
          {d && <Pill s={d.group.status} />}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900" aria-label="Close"><X size={18} /></button>
        </div>

        {!d && !error && <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-400" /></div>}
        {error && <p className="p-5 text-sm text-red-600">{error}</p>}
        {d && (
          <div className="p-5 space-y-6">
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Members · collecting order</h3>
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 bg-gray-50"><th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Member</th><th className="px-3 py-2 font-medium">KYC</th><th className="px-3 py-2 font-medium">Paid</th><th className="px-3 py-2 font-medium">Owes</th></tr></thead>
                  <tbody>
                    {d.members.map((m) => {
                      const now = d.group.status === 'active' && m.position === d.group.currentRound;
                      return (
                        <tr key={m.userId} className={`border-t border-gray-100 ${now ? 'bg-brand-50' : ''}`}>
                          <td className="px-3 py-2 font-semibold text-gray-700">{m.position ?? '·'}{now ? ' ◀' : ''}</td>
                          <td className="px-3 py-2"><p className="text-gray-900">{m.username ? `@${m.username}` : '—'}</p><p className="text-xs text-gray-500">{m.email}</p></td>
                          <td className="px-3 py-2 text-gray-700">T{m.kycTier}</td>
                          <td className="px-3 py-2 text-gray-700">{m.paidRounds}{m.missedRounds ? <span className="text-red-600"> · {m.missedRounds} short</span> : ''}</td>
                          <td className="px-3 py-2">{Number(m.owed) > 0 ? <span className="text-red-600 font-semibold">{ngn(m.owed)}</span> : <span className="text-gray-400">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Rounds</h3>
              {d.rounds.length === 0 ? (
                <p className="text-sm text-gray-500">No round has run yet{d.group.status === 'active' ? ` — round 1 is due ${when(d.group.nextDueAt)}` : ''}.</p>
              ) : (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 bg-gray-50"><th className="px-3 py-2 font-medium">Round</th><th className="px-3 py-2 font-medium">Collector</th><th className="px-3 py-2 font-medium">Collected so far</th><th className="px-3 py-2 font-medium">Paid / short</th><th className="px-3 py-2 font-medium">When</th></tr></thead>
                    <tbody>
                      {d.rounds.map((r) => (
                        <tr key={r.round} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-700">{r.round}</td>
                          <td className="px-3 py-2 text-gray-900">{r.recipient ? `@${r.recipient}` : '—'}</td>
                          <td className="px-3 py-2 font-semibold text-gray-900">{ngn(r.collected)} <span className="text-xs font-normal text-gray-500">of {ngn(d.group.pot)}</span></td>
                          <td className="px-3 py-2 text-gray-700">{r.paid}{r.short ? <span className="text-red-600"> / {r.short}</span> : ''}</td>
                          <td className="px-3 py-2 text-gray-500">{when(r.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="text-xs text-gray-500">
              Nothing here moves money. A member who owes is swept automatically when naira reaches their wallet; to reach them, use User management.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ debtors --

function DebtorsTab() {
  const { rows, loading, error } = useList<Debtor>('/api/ajo/debtors', 'debtors');
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-100">
            <th className="px-4 py-3 font-medium">Member</th>
            <th className="px-4 py-3 font-medium">Owes</th>
            <th className="px-4 py-3 font-medium">Rounds behind</th>
            <th className="px-4 py-3 font-medium">Since</th>
            <th className="px-4 py-3 font-medium">Groups</th>
            <th className="px-4 py-3 font-medium">Wallet now</th>
            <th className="px-4 py-3 font-medium">Account</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400"><Loader2 className="inline animate-spin" /></td></tr>}
          {!loading && error && <tr><td colSpan={7} className="px-4 py-6 text-center text-red-600">{error}</td></tr>}
          {!loading && !error && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Nobody owes anything. 🎉</td></tr>}
          {rows.map((r) => {
            const days = daysSince(r.since);
            return (
              <tr key={r.userId} className="border-b border-gray-50">
                <td className="px-4 py-3"><p className="font-semibold text-gray-900">{r.username ? `@${r.username}` : '—'}</p><p className="text-xs text-gray-500">{r.email}</p></td>
                <td className="px-4 py-3 font-semibold text-red-600">{ngn(r.owed)}</td>
                <td className="px-4 py-3 text-gray-700">{r.rounds}</td>
                <td className="px-4 py-3"><span className={days >= 14 ? 'text-red-600 font-semibold' : 'text-gray-700'}>{days}d</span> <span className="text-xs text-gray-500">({when(r.since)})</span></td>
                <td className="px-4 py-3 text-gray-700">{r.groups.join(', ')}</td>
                <td className="px-4 py-3 text-gray-700">{ngn(r.walletNgn)}</td>
                <td className="px-4 py-3"><Pill s={r.accountStatus.toLowerCase()} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
        Red after 14 days. Money in a debtor’s wallet is swept to their group within a minute, so a non-zero wallet here usually means the sweep is about to run.
      </p>
    </div>
  );
}

// -------------------------------------------------------------- plans --

function PlansTab() {
  const [filter, setFilter] = useState<(typeof PLAN_FILTERS)[number]>('active');
  const { rows, loading, error } = useList<Plan>(`/api/ajo/plans?status=${filter}`, 'plans');
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        {PLAN_FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize ${filter === f ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{f}</button>
        ))}
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Each</th>
              <th className="px-4 py-3 font-medium">Saved / goal</th>
              <th className="px-4 py-3 font-medium">Progress</th>
              <th className="px-4 py-3 font-medium">Next due</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400"><Loader2 className="inline animate-spin" /></td></tr>}
            {!loading && error && <tr><td colSpan={7} className="px-4 py-6 text-center text-red-600">{error}</td></tr>}
            {!loading && !error && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No plans here yet.</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-gray-50">
                <td className="px-4 py-3"><p className="font-semibold text-gray-900">{p.name}</p><p className="text-xs text-gray-500">{p.frequency} · started {when(p.createdAt)}</p></td>
                <td className="px-4 py-3"><p className="text-gray-900">{p.user.username ? `@${p.user.username}` : '—'}</p><p className="text-xs text-gray-500">{p.user.email}</p></td>
                <td className="px-4 py-3 text-gray-700">{ngn(p.amount)}</td>
                <td className="px-4 py-3 text-gray-700"><span className="font-semibold text-gray-900">{ngn(p.saved)}</span> / {ngn(p.target)}</td>
                <td className="px-4 py-3 text-gray-700">{p.paidCount}/{p.totalCount}{p.missedCount ? <span className="text-red-600"> · {p.missedCount} missed</span> : ''}</td>
                <td className="px-4 py-3 text-gray-700">{p.status === 'active' ? when(p.nextDueAt) : when(p.closedAt)}</td>
                <td className="px-4 py-3"><Pill s={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
