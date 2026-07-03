'use client';

import React, { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { ShieldCheck, Trash2, Plus, Lock } from 'lucide-react';

type RolesData = { admins: string[]; envAdmins: string[] };

export default function RolesPage() {
  const [data, setData] = useState<RolesData | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [input, setInput] = useState('');
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
      .then((d) => {
        if (!active) return;
        setData(d);
        setEmails(Array.isArray(d.admins) ? d.admins : []);
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const add = () => {
    const e = input.trim().toLowerCase();
    if (e && e.includes('@') && !emails.includes(e)) {
      setEmails([...emails, e]);
      setInput('');
      setSaved(false);
    }
  };
  const remove = (e: string) => {
    setEmails(emails.filter((x) => x !== e));
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
        body: JSON.stringify({ emails }),
      });
      if (!res.ok) throw new Error('Failed to save (' + res.status + ')');
      const d = await res.json();
      setEmails(Array.isArray(d.admins) ? d.admins : emails);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Roles &amp; Access</h1>
        <p className="text-gray-600 mt-2">Manage which accounts have admin access to this dashboard</p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {loading && <p className="text-gray-500">Loading…</p>}

      {data && (
        <div className="space-y-6 max-w-2xl">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck size={20} className="text-brand-600" />
              <h2 className="text-lg font-bold text-gray-900">Admin allowlist</h2>
            </div>
            <div className="flex gap-2 mb-4">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                type="email"
                placeholder="admin@example.com"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button onClick={add} className="flex items-center gap-1 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
                <Plus size={16} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {emails.length === 0 && <p className="text-sm text-gray-400">No managed admins yet.</p>}
              {emails.map((e) => (
                <div key={e} className="flex items-center justify-between px-4 py-2 rounded-lg bg-gray-50 border border-gray-100">
                  <span className="text-sm text-gray-800">{e}</span>
                  <button onClick={() => remove(e)} className="text-red-500 hover:text-red-700" aria-label="Remove"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3">
              <button onClick={save} disabled={saving} className="px-5 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && <span className="text-sm text-green-600">Saved ✓</span>}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-2">
              <Lock size={18} className="text-gray-400" />
              <h2 className="text-lg font-bold text-gray-900">Environment admins</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">Defined via the <code className="font-mono">ADMIN_EMAILS</code> environment variable. Read-only here; these accounts always retain access.</p>
            <div className="space-y-2">
              {data.envAdmins.length === 0 && <p className="text-sm text-gray-400">None configured.</p>}
              {data.envAdmins.map((e) => (
                <div key={e} className="px-4 py-2 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-700">{e}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
