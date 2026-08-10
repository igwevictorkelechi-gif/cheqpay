'use client';

import React, { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import {
  Activity, CheckCircle2, XCircle, Loader2, ShieldAlert, PlugZap,
} from 'lucide-react';

type Probe = {
  name: string;
  proves: string;
  ok: boolean;
  detail: string;
  ms: number;
};

type CheckResult = {
  configured: boolean;
  paymentProvider?: string;
  custodyProvider?: string;
  baseUrl?: string;
  webhookSecretConfigured?: boolean;
  allPassed?: boolean;
  summary: string;
  probes: Probe[];
};

/**
 * Provider check — "does Maplerad actually work from the deployed API?"
 *
 * Distinct from Provider Settings, which reads environment variables and so can
 * only say whether keys are *present*. This runs real read-only calls and can
 * therefore catch the failures that matter in practice: a rotated key, an
 * un-whitelisted egress IP, or collections still switched off on the business.
 *
 * Deliberately click-to-run rather than on mount: it hits a third party, and a
 * page that fires four live API calls every time somebody navigates to it is
 * rude to the provider and slow for the operator.
 */
export default function ProviderCheckPage() {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/provider-check', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) {
        throw new Error(
          d?.error ??
            (r.status === 403
              ? 'The dashboard could not authenticate to the backend API. Set the SAME ADMIN_API_SECRET on both projects and redeploy.'
              : `The check could not be run (HTTP ${r.status}).`)
        );
      }
      setResult(d as CheckResult);
    } catch (e) {
      setError(
        e instanceof Error
          ? // A browser-level abort reads as a generic network failure; name the
            // likely cause, because a hanging check usually IS the answer.
            /abort|timeout/i.test(e.message)
            ? 'The check timed out. Maplerad did not answer within 60s, which usually means the API server cannot reach it at all.'
            : e.message
          : 'The check could not be run.'
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Provider Check</h1>
        <p className="text-gray-600 mt-2">
          Run live read-only calls against Maplerad to confirm the API can actually reach it
        </p>
      </div>

      <div className="mb-6 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <PlugZap size={18} className="mt-0.5 shrink-0" />
        <p>
          These probes only <strong>read</strong> — bank lists, business wallets and billers.
          Nothing moves money, enrolls a customer or creates an account, so this is safe to
          run against live keys at any time.
        </p>
      </div>

      <button
        onClick={run}
        disabled={running}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        {running ? <Loader2 size={18} className="animate-spin" /> : <Activity size={18} />}
        {running ? 'Running checks…' : 'Run the check'}
      </button>

      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div
            className={
              'rounded-lg border p-4 ' +
              (result.allPassed
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-amber-200 bg-amber-50 text-amber-900')
            }
          >
            <p className="font-semibold">{result.summary}</p>
            {result.configured && (
              <p className="mt-2 text-sm opacity-90">
                Payments: <strong>{result.paymentProvider}</strong> · Custody:{' '}
                <strong>{result.custodyProvider}</strong> · Webhook secret:{' '}
                <strong>{result.webhookSecretConfigured ? 'set' : 'missing'}</strong>
              </p>
            )}
          </div>

          {result.probes.map((p) => (
            <div
              key={p.name}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {p.ok ? (
                      <CheckCircle2 size={18} className="shrink-0 text-green-600" />
                    ) : (
                      <XCircle size={18} className="shrink-0 text-red-600" />
                    )}
                    <h2 className="font-semibold text-gray-900">{p.name}</h2>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">Proves: {p.proves}</p>
                  <p
                    className={
                      'mt-2 text-sm ' + (p.ok ? 'text-gray-700' : 'text-red-700')
                    }
                  >
                    {p.detail}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-gray-400">{p.ms}ms</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
