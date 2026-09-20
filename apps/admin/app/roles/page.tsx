'use client';

import React, { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { ShieldCheck, Trash2, Plus, Lock, Crown } from 'lucide-react';

type Role = 'admin' | 'super';
type Managed = { email: string; role: Role };
type RolesData = { admins: Managed[]; envAdmins: string[] };

export default function RolesPage() {
  const [envAdmins, setEnvAdmins] = useState<string[]>([]);
  const [admins, setAdmins] = useState<Managed[]>([]);
  const [input, setInput] = useState('');
  const [newRole, setNewRole] = useState<Role>('admin');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/roles')
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load roles (' + r.status + ')');
        return r.json();
      })
      .then((d: RolesData) => {
        if (!active) return;
        setEnvAdmins(Array.isArray(d.envAdmins) ? d.envAdmins : []);
        setAdmins(
          Array.isArray(d.admins)
            ? d.admins.map((a) => ({ email: a.email, role: a.role === 'super' ? 'super' : 'admin' }))
            : [],
        );
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const add = () => {
    const e = input.trim().toLowerCase();
    if (e && e.includes('@') && !admins.some((a) => a.email === e) && !envAdmins.includes(e)) {
      setAdmins([...admins, { email: e, role: newRole }]);
      setInput('');
      setNewRole('admin');
      setSaved(false);
    }
  };
  const remove = (email: string) => {
    setAdmins(admins.filter((a) => a.email !== email));
    setSaved(false);
  };
  const setRole = (email: string, role: Role) => {
    setAdmins(admins.map((a) => (a.email === email ? { ...a, role } : a)));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/roles', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ admins }),
      });
      if (!res.ok) throw new Error('Failed to save (' + res.status + ')');
      const d: RolesData = await res.json();
      setAdmins(
        Array.isArray(d.admins)
          ? d.admins.map((a) => ({ email: a.email, role: a.role === 'super' ? 'super' : 'admin' }))
          : admins,
      );
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const roleBtn = (active: boolean, cls: string) =>
    'px-3 py-1.5 text-xs font-semibold transition-colors ' +
    (active ? cls : 'bg-white text-gray-500 hover:bg-gray-50');

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Roles &amp; Access</h1>
        <p className="text-gray-600 mt-2">
          Manage who can sign in, and whether they are a Super Admin or a regular Admin.
        </p>
      </div>

      {/* Legend */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 max-w-3xl">
        <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
          <div className="flex items-center gap-2 font-semibold text-brand-700">
            <Crown size={16} /> Super Admin
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Full access, including Roles &amp; Access, Provider &amp; Payment Settings,
            Adjust Balance, and Feature Toggles.
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 font-semibold text-gray-700">
            <ShieldCheck size={16} /> Admin
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Day-to-day operations. The four areas above are hidden and blocked.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {loading && <p className="text-gray-500">Loading…</p>}

      {!loading && (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck size={20} className="text-brand-600" />
              <h2 className="text-lg font-bold text-gray-900">Managed admins</h2>
            </div>

            {/* Add form */}
            <div className="flex flex-col gap-2 sm:flex-row mb-4">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                type="email"
                placeholder="admin@example.com"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="admin">Admin</option>
                <option value="super">Super Admin</option>
              </select>
              <button onClick={add} className="flex items-center justify-center gap-1 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
                <Plus size={16} /> Add
              </button>
            </div>

            <div className="space-y-2">
              {admins.length === 0 && <p className="text-sm text-gray-400">No managed admins yet.</p>}
              {admins.map((a) => (
                <div key={a.email} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 rounded-lg bg-gray-50 border border-gray-100">
                  <span className="text-sm text-gray-800">{a.email}</span>
                  <div className="flex items-center gap-3">
                    <div className="inline-flex overflow-hidden rounded-lg border border-gray-300">
                      <button
                        onClick={() => setRole(a.email, 'admin')}
                        className={roleBtn(a.role === 'admin', 'bg-gray-700 text-white')}
                      >
                        Admin
                      </button>
                      <button
                        onClick={() => setRole(a.email, 'super')}
                        className={roleBtn(a.role === 'super', 'bg-brand-600 text-white')}
                      >
                        Super
                      </button>
                    </div>
                    <button onClick={() => remove(a.email)} className="text-red-500 hover:text-red-700" aria-label="Remove"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button onClick={save} disabled={saving} className="px-5 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && <span className="text-sm text-green-600">Saved ✓</span>}
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Role changes take effect the next time that admin signs in.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-2">
              <Lock size={18} className="text-gray-400" />
              <h2 className="text-lg font-bold text-gray-900">Environment Super Admins</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Defined via the <code className="font-mono">ADMIN_EMAILS</code> environment variable.
              Always Super Admins and read-only here — these accounts can never be locked out.
            </p>
            <div className="space-y-2">
              {envAdmins.length === 0 && <p className="text-sm text-gray-400">None configured.</p>}
              {envAdmins.map((e) => (
                <div key={e} className="flex items-center justify-between px-4 py-2 rounded-lg bg-gray-50 border border-gray-100">
                  <span className="text-sm text-gray-700">{e}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                    <Crown size={11} /> Super Admin
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
