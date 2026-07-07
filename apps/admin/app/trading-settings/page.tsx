'use client';

import { useEffect, useState } from 'react';
import { Percent, DollarSign, Save, Banknote, Receipt, ArrowDownToLine } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Settings {
  spreadBps: number;
  usdtNgnRate: number | null;
  depositFeeBps: number;
  withdrawalFeeNgn: number;
  billMarginBps: number;
}

export default function TradingSettingsPage() {
  const [spreadBps, setSpreadBps] = useState('');
  const [usdtNgnRate, setUsdtNgnRate] = useState('');
  const [depositFeeBps, setDepositFeeBps] = useState('');
  const [withdrawalFeeNgn, setWithdrawalFeeNgn] = useState('');
  const [billMarginBps, setBillMarginBps] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function applySnapshot(data: Settings) {
    setSpreadBps(String(data.spreadBps ?? ''));
    setUsdtNgnRate(data.usdtNgnRate != null ? String(data.usdtNgnRate) : '');
    setDepositFeeBps(String(data.depositFeeBps ?? 0));
    setWithdrawalFeeNgn(String(data.withdrawalFeeNgn ?? 0));
    setBillMarginBps(String(data.billMarginBps ?? 0));
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/platform-settings', { cache: 'no-store' });
      const data: Settings = await res.json();
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error ?? 'Failed to load');
      applySnapshot(data);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, number> = {};
      if (spreadBps !== '') payload.spreadBps = Number(spreadBps);
      if (usdtNgnRate !== '') payload.usdtNgnRate = Number(usdtNgnRate);
      if (depositFeeBps !== '') payload.depositFeeBps = Number(depositFeeBps);
      if (withdrawalFeeNgn !== '') payload.withdrawalFeeNgn = Number(withdrawalFeeNgn);
      if (billMarginBps !== '') payload.billMarginBps = Number(billMarginBps);

      const res = await fetch('/api/platform-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      applySnapshot(data);
      setMessage({ kind: 'ok', text: 'Settings saved. They apply to new transactions immediately.' });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  }

  const pct = (bps: string) => (bps !== '' ? (Number(bps) / 100).toFixed(2) : '—');

  const inputCls =
    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Fees &amp; Trading</h1>
        <p className="text-gray-600 mt-2">
          Business-controlled rates and fees. All apply server-side immediately — no redeploy.
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
        <h2 className="text-lg font-bold text-gray-900">Trading</h2>

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
            className={inputCls}
            placeholder="150"
          />
          <p className="text-sm text-gray-500 mt-2">
            100 bps = 1%. Current margin: <span className="font-semibold">{pct(spreadBps)}%</span>
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
            className={inputCls}
            placeholder="e.g. 1750"
          />
          <p className="text-sm text-gray-500 mt-2">
            Naira paid per 1 USDT before spread. The crypto leg comes from Binance.
          </p>
        </div>

        <h2 className="text-lg font-bold text-gray-900 pt-2">Fees &amp; margins</h2>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <ArrowDownToLine size={18} className="text-brand-600" />
            Deposit fee (basis points)
          </label>
          <input
            type="number"
            min={0}
            max={500}
            step={1}
            value={depositFeeBps}
            onChange={(e) => setDepositFeeBps(e.target.value)}
            disabled={loading || saving}
            className={inputCls}
            placeholder="0"
          />
          <p className="text-sm text-gray-500 mt-2">
            Taken from each Naira deposit before crediting ({pct(depositFeeBps)}%). Max 500 bps
            (5%). Set 0 for free deposits.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <Banknote size={18} className="text-brand-600" />
            Withdrawal fee (flat ₦)
          </label>
          <input
            type="number"
            min={0}
            max={10000}
            step="0.01"
            value={withdrawalFeeNgn}
            onChange={(e) => setWithdrawalFeeNgn(e.target.value)}
            disabled={loading || saving}
            className={inputCls}
            placeholder="0"
          />
          <p className="text-sm text-gray-500 mt-2">
            Added on top of each bank payout — the user is debited amount + fee. Set 0 for free
            withdrawals.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <Receipt size={18} className="text-brand-600" />
            Bill payment margin (basis points)
          </label>
          <input
            type="number"
            min={0}
            max={2000}
            step={1}
            value={billMarginBps}
            onChange={(e) => setBillMarginBps(e.target.value)}
            disabled={loading || saving}
            className={inputCls}
            placeholder="0"
          />
          <p className="text-sm text-gray-500 mt-2">
            Profit added on airtime, data, electricity, cable &amp; betting ({pct(billMarginBps)}%).
            The biller receives the bill amount; the user pays amount + margin. Max 2000 bps (20%).
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
