'use client';

import { useEffect, useState } from 'react';
import {
  Percent,
  DollarSign,
  Save,
  Banknote,
  Receipt,
  ArrowDownToLine,
  Gift,
  ArrowLeftRight,
} from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

const BILL_SERVICES = [
  { key: 'airtime', label: 'Airtime' },
  { key: 'data', label: 'Data' },
  { key: 'electricity', label: 'Electricity' },
  { key: 'cabletv', label: 'Cable TV' },
  { key: 'betting', label: 'Betting' },
  { key: 'food', label: 'Food' },
] as const;

type BillService = (typeof BILL_SERVICES)[number]['key'];

/** Per service: a number is its own rate; null means it uses the default. */
type BillMargins = Record<BillService, number | null>;

interface Settings {
  spreadBps: number;
  usdtNgnRate: number | null;
  depositFeeBps: number;
  withdrawalFeeNgn: number;
  fxMarginBps: number;
  billMarginBps: number;
  billMargins: BillMargins;
  cashbackEnabled: boolean;
  cashbackDepositBps: number;
  cashbackWithdrawalBps: number;
  cashbackBillBps: number;
  cashbackTradeBps: number;
  cashbackMaxNgn: number;
}

export default function TradingSettingsPage() {
  const [spreadBps, setSpreadBps] = useState('');
  const [usdtNgnRate, setUsdtNgnRate] = useState('');
  const [depositFeeBps, setDepositFeeBps] = useState('');
  const [withdrawalFeeNgn, setWithdrawalFeeNgn] = useState('');
  const [fxMarginBps, setFxMarginBps] = useState('');
  const [billMarginBps, setBillMarginBps] = useState('');
  // '' means "uses the default" — distinct from '0', which pins face value.
  const [billMargins, setBillMargins] = useState<Record<string, string>>({});
  const [cashbackEnabled, setCashbackEnabled] = useState(false);
  const [cashbackDepositBps, setCashbackDepositBps] = useState('');
  const [cashbackWithdrawalBps, setCashbackWithdrawalBps] = useState('');
  const [cashbackBillBps, setCashbackBillBps] = useState('');
  const [cashbackTradeBps, setCashbackTradeBps] = useState('');
  const [cashbackMaxNgn, setCashbackMaxNgn] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function applySnapshot(data: Settings) {
    setSpreadBps(String(data.spreadBps ?? ''));
    setUsdtNgnRate(data.usdtNgnRate != null ? String(data.usdtNgnRate) : '');
    setDepositFeeBps(String(data.depositFeeBps ?? 0));
    setWithdrawalFeeNgn(String(data.withdrawalFeeNgn ?? 0));
    setFxMarginBps(String(data.fxMarginBps ?? 0));
    setBillMarginBps(String(data.billMarginBps ?? 0));
    setBillMargins(
      Object.fromEntries(
        BILL_SERVICES.map(({ key }) => {
          const v = data.billMargins?.[key];
          return [key, v == null ? '' : String(v)];
        }),
      ),
    );
    setCashbackEnabled(Boolean(data.cashbackEnabled));
    setCashbackDepositBps(String(data.cashbackDepositBps ?? 0));
    setCashbackWithdrawalBps(String(data.cashbackWithdrawalBps ?? 0));
    setCashbackBillBps(String(data.cashbackBillBps ?? 0));
    setCashbackTradeBps(String(data.cashbackTradeBps ?? 0));
    setCashbackMaxNgn(String(data.cashbackMaxNgn ?? 0));
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
      const payload: Record<string, unknown> = {};
      if (spreadBps !== '') payload.spreadBps = Number(spreadBps);
      if (usdtNgnRate !== '') payload.usdtNgnRate = Number(usdtNgnRate);
      if (depositFeeBps !== '') payload.depositFeeBps = Number(depositFeeBps);
      if (withdrawalFeeNgn !== '') payload.withdrawalFeeNgn = Number(withdrawalFeeNgn);
      if (billMarginBps !== '') payload.billMarginBps = Number(billMarginBps);
      if (fxMarginBps !== '') payload.fxMarginBps = Number(fxMarginBps);
      // A blank box clears the override (null) so that service follows the
      // default again; '0' is sent as a real rate meaning face value.
      payload.billMargins = Object.fromEntries(
        BILL_SERVICES.map(({ key }) => {
          const raw = billMargins[key] ?? '';
          return [key, raw === '' ? null : Number(raw)];
        }),
      );
      payload.cashbackEnabled = cashbackEnabled;
      if (cashbackDepositBps !== '') payload.cashbackDepositBps = Number(cashbackDepositBps);
      if (cashbackWithdrawalBps !== '')
        payload.cashbackWithdrawalBps = Number(cashbackWithdrawalBps);
      if (cashbackBillBps !== '') payload.cashbackBillBps = Number(cashbackBillBps);
      if (cashbackTradeBps !== '') payload.cashbackTradeBps = Number(cashbackTradeBps);
      if (cashbackMaxNgn !== '') payload.cashbackMaxNgn = Number(cashbackMaxNgn);

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
            The fallback rate ({pct(billMarginBps)}%), used by any service without one of its own
            below. The biller receives the bill amount; the user pays amount + margin. Max 2000 bps
            (20%).
          </p>

          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="text-sm font-semibold text-gray-700">Per service</p>
            <p className="text-xs text-gray-500 mt-1 mb-3">
              Leave a box empty to use the default. Enter <span className="font-medium">0</span> to
              sell that service at face value — on airtime especially, the markup is visible to the
              user, who pays more than the credit they receive.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {BILL_SERVICES.map(({ key, label }) => {
                const raw = billMargins[key] ?? '';
                return (
                  <div key={key}>
                    <label
                      htmlFor={`margin-${key}`}
                      className="block text-xs font-medium text-gray-600 mb-1"
                    >
                      {label}
                    </label>
                    <input
                      id={`margin-${key}`}
                      type="number"
                      min={0}
                      max={2000}
                      step={1}
                      value={raw}
                      onChange={(e) =>
                        setBillMargins((m) => ({ ...m, [key]: e.target.value }))
                      }
                      disabled={loading || saving}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={`default (${pct(billMarginBps)}%)`}
                    />
                    <p className="text-[11px] text-gray-400 mt-1">
                      {raw === '' ? `Using default · ${pct(billMarginBps)}%` : `${pct(raw)}%`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <ArrowLeftRight size={18} className="text-brand-600" />
            Naira ⇄ Dollar conversion spread (basis points)
          </label>
          <input
            type="number"
            min={0}
            max={1000}
            step={1}
            value={fxMarginBps}
            onChange={(e) => setFxMarginBps(e.target.value)}
            disabled={loading || saving}
            className={inputCls}
            placeholder="0"
          />
          <p className="text-sm text-gray-500 mt-2">
            Withheld from every NGN⇄USD conversion ({pct(fxMarginBps)}%). This rail is priced by
            Maplerad, so the trading spread above never reaches it — at 0 the provider&apos;s raw
            rate goes straight to the user and the business earns nothing. Max 1000 bps (10%).
          </p>
        </div>

        {/* Cashback rewards */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-2 text-gray-700 font-semibold">
              <Gift size={18} className="text-brand-600" />
              Cashback rewards
            </span>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm font-semibold text-gray-700">
                {cashbackEnabled ? 'On' : 'Off'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={cashbackEnabled}
                onClick={() => setCashbackEnabled((v) => !v)}
                disabled={loading || saving}
                className={
                  'relative h-7 w-12 rounded-full transition-colors ' +
                  (cashbackEnabled ? 'bg-brand-600' : 'bg-gray-300')
                }
              >
                <span
                  className={
                    'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ' +
                    (cashbackEnabled ? 'translate-x-5' : 'translate-x-0.5')
                  }
                />
              </button>
            </label>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Paid in Naira into the user&rsquo;s wallet as its own transaction, right after the
            earning one succeeds. Rates are per kind because the economics differ. Every rate
            defaults to 0, so nothing pays out until you set it.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(
              [
                ['Deposits', cashbackDepositBps, setCashbackDepositBps],
                ['Withdrawals', cashbackWithdrawalBps, setCashbackWithdrawalBps],
                ['Bill payments', cashbackBillBps, setCashbackBillBps],
                ['Buy / sell trades', cashbackTradeBps, setCashbackTradeBps],
              ] as const
            ).map(([label, value, setter]) => (
              <div key={label}>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  {label} (basis points)
                </label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  disabled={loading || saving || !cashbackEnabled}
                  className={inputCls}
                  placeholder="0"
                />
                <p className="text-xs text-gray-500 mt-1">{pct(value)}% back</p>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Maximum per transaction (NGN)
            </label>
            <input
              type="number"
              min={0}
              max={100000}
              step={1}
              value={cashbackMaxNgn}
              onChange={(e) => setCashbackMaxNgn(e.target.value)}
              disabled={loading || saving || !cashbackEnabled}
              className={inputCls}
              placeholder="0"
            />
            <p className="text-sm text-gray-500 mt-2">
              Caps a single reward, so one very large transaction cannot pay out an unbounded
              amount. 0 means uncapped. Max 1000 bps (10%) on any rate.
            </p>
          </div>
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
