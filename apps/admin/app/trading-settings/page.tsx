'use client';

import { useEffect, useState } from 'react';
import { Percent, DollarSign, Save } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Settings {
  spreadBps: number;
  usdtNgnRate: number | null;
}

export default function TradingSettingsPage() {
  const [spreadBps, setSpreadBps] = useState('');
  const [usdtNgnRate, setUsdtNgnRate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/platform-settings', { cache: 'no-store' });
      const data: Settings = await res.json();
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error ?? 'Failed to load');
      setSpreadBps(String(data.spreadBps ?? ''));
      setUsdtNgnRate(data.usdtNgnRate != null ? String(data.usdtNgnRate) : '');
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, number> = {};
      if (spreadBps !== '') payload.spreadBps = Number(spreadBps);
      if (usdtNgnRate !== '') payload.usdtNgnRate = Number(usdtNgnRate);

      const res = await fetch('/api/platform-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      setSpreadBps(String(data.spreadBps));
      setUsdtNgnRate(data.usdtNgnRate != null ? String(data.usdtNgnRate) : '');
      setMessage({ kind: 'ok', text: 'Settings saved.' });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  }

  const spreadPct = spreadBps !== '' ? (Number(spreadBps) / 100).toFixed(2) : '—';

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Trading Settings</h1>
        <p className="text-gray-600 mt-2">
          Control the swap spread/margin and the business USDT&rarr;NGN rate. These apply
          server-side to every quote.
        </p>
      </div>

      {message && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm ${
            message.kind === 'ok'
              ? 'bg-green-50 text-green-800'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="max-w-xl space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <Percent size={18} className="text-brand-600" />
            Swap spread (basis points)
          </label>
          <input
            type="number"
            min={0}
            max={10000}
            step={1}
            value={spreadBps}
            onChange={(e) => setSpreadBps(e.target.value)}
            disabled={loading || saving}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="150"
          />
          <p className="text-sm text-gray-500 mt-2">
            100 bps = 1%. Current margin: <span className="font-semibold">{spreadPct}%</span>
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <DollarSign size={18} className="text-brand-600" />
            Business USDT&rarr;NGN rate
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={usdtNgnRate}
            onChange={(e) => setUsdtNgnRate(e.target.value)}
            disabled={loading || saving}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="e.g. 1750"
          />
          <p className="text-sm text-gray-500 mt-2">
            Naira paid per 1 USDT before spread. The crypto leg comes from Binance.
          </p>
        </div>

        <button
          onClick={save}
          disabled={loading || saving}
          className="flex items-center gap-2 px-5 py-3 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          <Save size={18} />
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </DashboardLayout>
  );
}
