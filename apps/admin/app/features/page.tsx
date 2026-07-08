'use client';

import { useEffect, useState } from 'react';
import { ToggleLeft, AlertTriangle } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type FeatureDef = { key: string; label: string; description: string };

export default function FeaturesPage() {
  const [defs, setDefs] = useState<FeatureDef[]>([]);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/features', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load feature switches (' + r.status + ')');
        return r.json();
      })
      .then((d) => {
        setDefs(Array.isArray(d.definitions) ? d.definitions : []);
        setFlags(d.features ?? {});
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function toggle(key: string) {
    const nextValue = !flags[key];
    setSavingKey(key);
    setError(null);
    // Optimistic flip; roll back on failure.
    setFlags((f) => ({ ...f, [key]: nextValue }));
    try {
      const res = await fetch('/api/features', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: nextValue }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to save');
      setFlags(d.features ?? {});
    } catch (e) {
      setFlags((f) => ({ ...f, [key]: !nextValue }));
      setError((e as Error).message);
    } finally {
      setSavingKey(null);
    }
  }

  const anyOff = defs.some((d) => flags[d.key] === false);

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Feature Toggles</h1>
        <p className="text-gray-600 mt-2">
          Turn app features on or off for all users instantly — no deploy. Switched-off features
          are blocked server-side and show as &quot;temporarily unavailable&quot; in the app.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 max-w-2xl">{error}</div>
      )}

      {anyOff && (
        <div className="mb-6 flex items-start gap-2 rounded-lg bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-800 max-w-2xl">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Some features are currently switched OFF — users cannot use them right now.</span>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="max-w-2xl bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-100">
          {defs.map((d) => {
            const on = flags[d.key] !== false;
            const busy = savingKey === d.key;
            return (
              <div key={d.key} className="flex items-center gap-4 p-5">
                <div className={'p-2 rounded-lg ' + (on ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400')}>
                  <ToggleLeft size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{d.label}</p>
                  <p className="text-sm text-gray-500">{d.description}</p>
                </div>
                <span
                  className={
                    'px-2.5 py-1 rounded-full text-xs font-semibold ' +
                    (on ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')
                  }
                >
                  {on ? 'ON' : 'OFF'}
                </span>
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label={`Toggle ${d.label}`}
                  onClick={() => toggle(d.key)}
                  disabled={busy}
                  className={
                    'relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 ' +
                    (on ? 'bg-brand-600' : 'bg-gray-300')
                  }
                >
                  <span
                    className={
                      'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ' +
                      (on ? 'translate-x-5' : 'translate-x-0.5')
                    }
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}
