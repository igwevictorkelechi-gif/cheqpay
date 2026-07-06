'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Check, CreditCard, ExternalLink, KeyRound, XCircle } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Status = {
  payments: { provider: string; secretKeyConfigured: boolean; webhookConfigured: boolean };
  apiBaseUrl?: string;
};

function Pill({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
      <CheckCircle2 size={14} /> {okLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
      <XCircle size={14} /> {badLabel}
    </span>
  );
}

export default function PaymentSettingsPage() {
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/provider-status')
      .then(async (r) => {
        if (!r.ok) throw new Error('Couldn’t load payment settings (HTTP ' + r.status + ')');
        return r.json();
      })
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const live = Boolean(data && data.payments.provider.toLowerCase() !== 'mock');
  const webhookUrl = (data?.apiBaseUrl ?? 'https://cheqpay-admin453.vercel.app') + '/api/webhooks/flutterwave';

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Payment Gateway</h1>
        <p className="text-gray-600 mt-2">Flutterwave powers NGN deposits, bank payouts and bill payments</p>
      </div>

      <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3 max-w-3xl">
        <KeyRound className="text-blue-600 flex-shrink-0" size={20} />
        <div>
          <p className="font-semibold text-blue-900">Keys live in Vercel, not here</p>
          <p className="text-sm text-blue-800 mt-1">
            For security, API keys are set as environment variables on the backend API project
            (<code className="font-mono">FLUTTERWAVE_SECRET_KEY</code>, <code className="font-mono">FLUTTERWAVE_WEBHOOK_HASH</code>,
            <code className="font-mono"> PAYMENT_PROVIDER=flutterwave</code>) and never pass through this dashboard.
            Update them in Vercel → API project → Settings → Environment Variables, then redeploy.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 max-w-3xl">{error}</div>
      )}
      {loading && <p className="text-gray-500">Loading…</p>}

      {data && (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 rounded-lg bg-orange-100 text-orange-600"><CreditCard size={20} /></div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Flutterwave</h2>
                <p className="text-sm text-gray-500">Virtual accounts · transfers · bills</p>
              </div>
              <span className={'ml-auto px-3 py-1 rounded-full text-xs font-semibold ' + (live ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700')}>
                {live ? 'LIVE' : 'MOCK MODE'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Provider mode</p>
                <p className="font-semibold text-gray-900">{data.payments.provider}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Secret key</p>
                <Pill ok={data.payments.secretKeyConfigured} okLabel="Configured" badLabel="Not set" />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Webhook hash</p>
                <Pill ok={data.payments.webhookConfigured} okLabel="Configured" badLabel="Not set" />
              </div>
            </div>
            {!live && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>
                  Payments are in <b>mock</b> mode — deposits and payouts are simulated. Set{' '}
                  <code className="font-mono">PAYMENT_PROVIDER=flutterwave</code> plus the two keys above and redeploy to go live.
                </span>
              </div>
            )}
            <a
              href="https://app.flutterwave.com/dashboard/settings/apis"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              Open Flutterwave dashboard <ExternalLink size={14} />
            </a>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Webhook URL</h2>
            <p className="text-sm text-gray-500 mb-4">
              Paste this in Flutterwave → Settings → Webhooks, and set the same secret hash there
              as <code className="font-mono">FLUTTERWAVE_WEBHOOK_HASH</code> on the API project.
              It confirms deposits into virtual accounts and finalizes transfers.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 block bg-gray-900 text-green-400 p-3 rounded-lg text-sm overflow-x-auto">
                {webhookUrl}
              </code>
              <button
                onClick={copyWebhook}
                className="flex items-center gap-1.5 px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
