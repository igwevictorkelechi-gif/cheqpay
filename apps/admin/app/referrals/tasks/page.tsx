'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Task {
  id: string;
  title: string;
  description: string;
  kind: 'AUTO' | 'PROOF';
  metric: string | null;
  metricLabel: string | null;
  target: string | null;
  targetFormatted: string | null;
  rewardMinor: string;
  rewardFormatted: string;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  completed: number;
  pendingSubmissions: number;
}
interface Submission {
  id: string;
  taskTitle: string;
  rewardFormatted: string;
  email: string;
  code: string | null;
  proofUrl: string | null;
  note: string | null;
  status: string;
  createdAt: string;
}

const EMPTY = { id: '', title: '', description: '', kind: 'PROOF' as 'AUTO' | 'PROOF', metric: 'signups', target: '', reward: '', endsAt: '', assigned: '', active: true };

/**
 * Tasks influencers can complete for a reward. Automatic tasks are counted
 * from our own data and paid once the target is hit; proof tasks (posts,
 * reels…) are approved here. Saving a task or approving proof asks for your
 * authenticator code.
 */
export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([
        fetch('/api/referrals/tasks', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/referrals/submissions?status=PENDING', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (t.error) throw new Error(t.error);
      setTasks(t.tasks);
      setMetrics(t.metrics);
      setSubs(s.submissions ?? []);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/referrals/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(form.id ? { id: form.id } : {}),
          title: form.title,
          description: form.description,
          kind: form.kind,
          metric: form.kind === 'AUTO' ? form.metric : null,
          target: form.kind === 'AUTO' ? Number(form.target) : null,
          reward: Number(form.reward),
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
          assigned: form.assigned.split(',').map((s) => s.trim()).filter(Boolean),
          active: form.active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      setMessage({ kind: 'ok', text: 'Task saved.' });
      setForm(EMPTY);
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function decide(s: Submission, approve: boolean) {
    setMessage(null);
    const res = await fetch(`/api/referrals/submissions/${s.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(approve ? { approve } : { approve, reason: reasons[s.id] ?? '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setMessage({ kind: 'err', text: data.error ?? 'Failed' });
    else setMessage({ kind: 'ok', text: approve ? `Approved — ${s.rewardFormatted} will be paid after the hold.` : 'Rejected.' });
    await load();
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
  const valid = form.title.trim().length >= 3 && Number(form.reward) > 0 && (form.kind === 'PROOF' || Number(form.target) > 0);

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Influencer tasks</h1>
        <p className="mt-2 text-gray-600">Automatic tasks pay themselves when the target is reached (checked daily and whenever the influencer opens their dashboard).</p>
      </div>
      {message && <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}

      {subs.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/50 p-5">
          <p className="mb-3 font-semibold text-gray-900">Proof to review ({subs.length})</p>
          <div className="space-y-3">
            {subs.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">{s.taskTitle} <span className="font-normal text-gray-500">· {s.email}{s.code ? ` (${s.code})` : ''}</span></p>
                  {s.proofUrl && <a href={s.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">{s.proofUrl.slice(0, 70)} <ExternalLink className="h-3 w-3" /></a>}
                  {s.note && <p className="text-xs text-gray-600">{s.note}</p>}
                </div>
                <input value={reasons[s.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [s.id]: e.target.value })} placeholder="Reason if rejecting" className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <button onClick={() => decide(s, false)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700">Reject</button>
                <button onClick={() => decide(s, true)} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white">Approve · {s.rewardFormatted}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6 grid gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-6">
        <label className="text-xs font-semibold text-gray-600 md:col-span-3">Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Post a CheqPay reel" className={`${input} mt-1`} /></label>
        <label className="text-xs font-semibold text-gray-600">Type
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'AUTO' | 'PROOF' })} className={`${input} mt-1`}>
            <option value="PROOF">Proof (we check)</option>
            <option value="AUTO">Automatic</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">Reward (₦)<input value={form.reward} onChange={(e) => setForm({ ...form, reward: e.target.value.replace(/[^\d.]/g, '') })} className={`${input} mt-1`} /></label>
        <label className="text-xs font-semibold text-gray-600">Ends (optional)<input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className={`${input} mt-1`} /></label>
        {form.kind === 'AUTO' && (
          <>
            <label className="text-xs font-semibold text-gray-600 md:col-span-3">Measure
              <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} className={`${input} mt-1`}>
                {Object.entries(metrics).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600">Target {form.metric === 'volume_ngn' ? '(₦)' : '(count)'}<input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value.replace(/[^\d.]/g, '') })} className={`${input} mt-1`} /></label>
          </>
        )}
        <label className="text-xs font-semibold text-gray-600 md:col-span-4">Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What they need to do, any rules" className={`${input} mt-1`} /></label>
        <label className="text-xs font-semibold text-gray-600 md:col-span-2">Only for (emails, comma-separated; blank = all)<input value={form.assigned} onChange={(e) => setForm({ ...form, assigned: e.target.value })} className={`${input} mt-1`} /></label>
        <div className="flex items-center gap-3 md:col-span-6">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
          <button onClick={save} disabled={!valid || saving} className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : form.id ? 'Update task' : 'Create task'}</button>
          {form.id && <button onClick={() => setForm(EMPTY)} className="text-sm text-gray-500">Cancel edit</button>}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-3">Task</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Reward</th><th className="px-4 py-3">Completed</th><th className="px-4 py-3">Ends</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {tasks.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No tasks yet.</td></tr>}
              {tasks.map((t) => (
                <tr key={t.id} className={`border-t border-gray-100 ${t.active ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-3"><p className="font-semibold text-gray-900">{t.title}</p><p className="text-xs text-gray-500">{t.kind === 'AUTO' ? `${t.metricLabel}: ${t.targetFormatted}` : t.description}</p></td>
                  <td className="px-4 py-3">{t.kind === 'AUTO' ? 'Automatic' : 'Proof'}</td>
                  <td className="px-4 py-3 font-semibold">{t.rewardFormatted}</td>
                  <td className="px-4 py-3">{t.completed}{t.pendingSubmissions ? ` (+${t.pendingSubmissions} to review)` : ''}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{t.endsAt ? new Date(t.endsAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setForm({
                        id: t.id, title: t.title, description: t.description, kind: t.kind, metric: t.metric ?? 'signups',
                        target: t.target ? String(t.metric === 'volume_ngn' ? Number(t.target) / 100 : Number(t.target)) : '',
                        reward: String(Number(t.rewardMinor) / 100), endsAt: t.endsAt ? t.endsAt.slice(0, 10) : '', assigned: '', active: t.active,
                      })}
                      className="text-xs font-semibold text-brand-600"
                    >
                      Edit
                    </button>
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
