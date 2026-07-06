'use client';

import React, { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Server, CreditCard, TrendingUp, ShieldAlert, CheckCircle2, XCircle, KeyRound } from 'lucide-react';

type Status = {
  custody: { provider: string; apiKeyConfigured: boolean; webhookConfigured: boolean };
  payments: { provider: string; secretKeyConfigured: boolean; webhookConfigured: boolean };
  priceFeed: string;
  relaxWithdrawalGuards: boolean;
  adminSecretConfigured: boolean;
};

function StatusPill({ ok, okLabel, badLabel }: { ok: boolean; okLabel?: string; badLabel?: string }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <CheckCircle2 size={14} /> {okLabel ?? 'Configured'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
      <XCircle size={14} /> {badLabel ?? 'Not set'}
    </span>
  );
}

function isLive(provider?: string): boolean {
  return Boolean(provider && provider.toLowerCase() !== 'mock');
}

export default function ProviderSettingsPage() {
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/provider-status')
      .then(async (r) => {
        if (!r.ok) {
          const hint =
            r.status === 401
              ? 'Your admin session is invalid. Log out and back in, and make sure ADMIN_DASHBOARD_SECRET is set on the admin (cheqpay-admin) project.'
              : r.status === 403
                ? 'The dashboard could not authenticate to the backend API. Set the SAME ADMIN_API_SECRET on BOTH the admin project (cheqpay-admin) and the API project (cheqpay-admin453), then redeploy both.'
                : r.status >= 500
                  ? 'The backend API is unreachable. Check CHEQPAY_API_URL on the admin project points to the API (https://cheqpay-admin453.vercel.app).'
                  : 'Unexpected error reaching the backend.';
          throw new Error(`Couldn’t load provider status (HTTP ${r.status}). ${hint}`);
        }
        return r.json();
      })
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Provider Settings</h1>
        <p className="text-gray-600 mt-2">Custody, payments &amp; price-feed configuration status</p>
      </div>

      <div className="mb-6 flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800">
        <KeyRound size={18} className="mt-0.5 shrink-0" />
        <span>
          For security, secret keys are set as environment variables in Vercel (not stored in the app).
          This page shows whether each key is configured. To change a key, update it in the
          <b> Vercel project → Settings → Environment Variables</b> and redeploy.
        </span>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {loading && <p className="text-gray-500">Loading…</p>}

      {data && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 rounded-lg bg-brand-100 text-brand-600"><Server size={20} /></div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Custody (Crypto)</h2>
                <p className="text-sm text-gray-500">Wallet creation, deposits &amp; withdrawals (Crypto APIs)</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Provider mode</p>
                <span className={'px-2.5 py-1 rounded-full text-xs font-medium ' + (isLive(data.custody.provider) ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700')}>{data.custody.provider}</span>
              </div>
              <div><p className="text-xs text-gray-500 mb-1">Custody API key</p><StatusPill ok={data.custody.apiKeyConfigured} /></div>
              <div><p className="text-xs text-gray-500 mb-1">Deposit webhook secret</p><StatusPill ok={data.custody.webhookConfigured} /></div>
            </div>
            {!isLive(data.custody.provider) && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                <span>Custody is in <b>mock</b> mode. To go live set <code className="font-mono">CUSTODY_PROVIDER=cryptoapis</code>, <code className="font-mono">CRYPTOAPIS_API_KEY</code>, <code className="font-mono">CRYPTOAPIS_WALLET_ID</code> and <code className="font-mono">CRYPTOAPIS_WEBHOOK_SECRET</code>, then redeploy.</span>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 rounded-lg bg-blue-100 text-blue-600"><CreditCard size={20} /></div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Payments (NGN)</h2>
                <p className="text-sm text-gray-500">NGN deposits, payouts &amp; bill payments (Flutterwave)</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Provider mode</p>
                <span className={'px-2.5 py-1 rounded-full text-xs font-medium ' + (isLive(data.payments.provider) ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700')}>{data.payments.provider}</span>
              </div>
              <div><p className="text-xs text-gray-500 mb-1">Flutterwave secret key</p><StatusPill ok={data.payments.secretKeyConfigured} /></div>
              <div><p className="text-xs text-gray-500 mb-1">Webhook hash</p><StatusPill ok={data.payments.webhookConfigured} /></div>
            </div>
            {!isLive(data.payments.provider) && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                <span>Payments are in <b>mock</b> mode. To go live set <code className="font-mono">PAYMENT_PROVIDER=flutterwave</code>, <code className="font-mono">FLUTTERWAVE_SECRET_KEY</code> and <code className="font-mono">FLUTTERWAVE_WEBHOOK_HASH</code>, then redeploy.</span>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 rounded-lg bg-purple-100 text-purple-600"><TrendingUp size={20} /></div>
              <h2 className="text-lg font-bold text-gray-900">System</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Price feed</p>
                <span className={'px-2.5 py-1 rounded-full text-xs font-medium ' + (isLive(data.priceFeed) ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700')}>{data.priceFeed}</span>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Withdrawal guards</p>
                <span className={'px-2.5 py-1 rounded-full text-xs font-medium ' + (data.relaxWithdrawalGuards ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>{data.relaxWithdrawalGuards ? 'RELAXED (testing)' : 'Enforced'}</span>
              </div>
              <div><p className="text-xs text-gray-500 mb-1">Admin API secret</p><StatusPill ok={data.adminSecretConfigured} /></div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
