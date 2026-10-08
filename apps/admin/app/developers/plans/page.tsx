'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Plan {
  id: 'sandbox' | 'starter' | 'growth' | 'scale';
  name: string;
  priceMinor: number;
  live: boolean;
  rpm: number;
  billFeeBps: number;
  billFeeCapMinor: number;
  depositFeeBps: number;
  depositFeeCapMinor: number;
  cardIssueFeeCents: number;
  cardFundFeeBps: number;
  maxCustomers: number;
  maxVirtualAccounts: number;
  maxActiveCards: number;
  webhookEndpoints: number;
}
type Limits = Record<string, number>;

// How each stored number is shown: [label, unit, multiplier from the shown value to the stored one].
const PLAN_FIELDS: [keyof Plan, string, string, number][] = [
  ['priceMinor', 'Price per month', '₦', 100],
  ['rpm', 'Requests per minute (per key)', '', 1],
  ['billFeeBps', 'Bill payment fee', '%', 100],
  ['billFeeCapMinor', 'Bill fee cap (0 = none)', '₦', 100],
  ['depositFeeBps', 'Deposit fee (virtual accounts)', '%', 100],
  ['depositFeeCapMinor', 'Deposit fee cap (0 = none)', '₦', 100],
  ['cardIssueFeeCents', 'Card issue fee', '$', 100],
  ['cardFundFeeBps', 'Card funding fee', '%', 100],
  ['maxCustomers', 'Max customers', '', 1],
  ['maxVirtualAccounts', 'Max virtual accounts', '', 1],
  ['maxActiveCards', 'Max active cards', '', 1],
  ['webhookEndpoints', 'Webhook endpoints', '', 1],
];

const LIMIT_FIELDS: [string, string, string, number][] = [
  ['dailyOutNgnMinor', 'Daily outflow', '₦', 100],
  ['dailyOutUsdMinor', 'Daily outflow', '$', 100],
  ['newDailyOutNgnMinor', 'Daily outflow, new accounts', '₦', 100],
  ['newDailyOutUsdMinor', 'Daily outflow, new accounts', '$', 100],
  ['maxFloatNgnMinor', 'Max balance across wallets', '₦', 100],
  ['maxFloatUsdMinor', 'Max balance across wallets', '$', 100],
  ['perTxnMaxNgnMinor', 'Largest single payment', '₦', 100],
  ['perTxnMaxUsdMinor', 'Largest single payment', '$', 100],
  ['newAccountDays', 'Days an account counts as new', '', 1],
];

/**
 * What developers pay and what they may do. Prices and fees apply to new
 * charges from the moment you save; limits apply to accounts without their own.
 * Saving asks for your authenticator code.
 */
export default function DeveloperPlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/developers/plans', { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Failed to load');
        setPlans(d.plans);
        setLimits(d.limits);
      })
      .catch((e) => setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' }));
  }, []);

  async function save() {
    if (!plans || !limits) return;
    setSaving(true);
    setMessage(null);
    try {
      const body = {
        plans: Object.fromEntries(
          plans.map((p) => [p.id, Object.fromEntries([['name', p.name], ...PLAN_FIELDS.filter(([k]) => !(p.id === 'sandbox' && k === 'priceMinor')).map(([k]) => [k, p[k]])])]),
        ),
        limits,
      };
      const r = await fetch('/api/developers/plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Failed to save');
      setPlans(d.plans);
      setLimits(d.limits);
      setMessage({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  const cell = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm';
  const shown = (stored: number, mult: number) => String(Math.round((stored / mult) * 100) / 100);
  const stored = (v: string, mult: number) => Math.round(Number(v.replace(/[^\d.]/g, '') || 0) * mult);

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Developer plans & limits</h1>
        <p className="mt-2 text-gray-600">Monthly plans are paid from the developer’s main NGN wallet. Fees are charged on top of each payment, from the wallet it is paid from.</p>
      </div>
      {message && <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}
      {!plans || !limits ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <div className="mb-8 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-semibold text-gray-600"> </th>
                  {plans.map((p) => (
                    <th key={p.id} className="px-4 py-3">
                      <input value={p.name} onChange={(e) => setPlans(plans.map((q) => (q.id === p.id ? { ...q, name: e.target.value } : q)))} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-center text-sm font-semibold" />
                      <span className="mt-1 block text-xs font-normal text-gray-500">{p.live ? 'live + test' : 'test only'}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLAN_FIELDS.map(([k, label, unit, mult]) => (
                  <tr key={k} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 text-gray-700">
                      {label} {unit && <span className="text-gray-400">({unit})</span>}
                    </td>
                    {plans.map((p) => (
                      <td key={p.id} className="px-4 py-2">
                        <input
                          disabled={p.id === 'sandbox' && k === 'priceMinor'}
                          value={shown(p[k] as number, mult)}
                          onChange={(e) => setPlans(plans.map((q) => (q.id === p.id ? { ...q, [k]: stored(e.target.value, mult) } : q)))}
                          className={`${cell} disabled:bg-gray-50`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mb-3 text-xl font-semibold text-gray-900">Default limits for live accounts</h2>
          <p className="mb-4 text-sm text-gray-600">They bound what one account can lose if its keys leak or it turns out to be fraudulent. Set an account’s own limits on its page.</p>
          <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-5 md:grid-cols-3">
            {LIMIT_FIELDS.map(([k, label, unit, mult]) => (
              <label key={k} className="text-sm text-gray-700">
                {label} {unit && <span className="text-gray-400">({unit})</span>}
                <input value={shown(limits[k], mult)} onChange={(e) => setLimits({ ...limits, [k]: stored(e.target.value, mult) })} className={`${cell} mt-1`} />
              </label>
            ))}
          </div>
          <button onClick={save} disabled={saving} className="rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </DashboardLayout>
  );
}
