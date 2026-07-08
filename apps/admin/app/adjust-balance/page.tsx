'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, KeyRound, ArrowDownToLine, ArrowUpFromLine, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

const ASSETS = ['NGN', 'BTC', 'USDT', 'USDC'] as const;

export default function AdjustBalancePage() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  // OTP setup state
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [activateCode, setActivateCode] = useState('');
  const [busy, setBusy] = useState(false);

  // Adjustment form state
  const [email, setEmail] = useState('');
  const [asset, setAsset] = useState<(typeof ASSETS)[number]>('NGN');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [reason, setReason] = useState('');
  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin-otp', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setConfigured(Boolean(d.configured)))
      .catch(() => setConfigured(false));
  }, []);

  async function beginSetup() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'setup' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Setup failed');
      setSetupUrl(d.otpauthUrl);
      setSetupSecret(d.secret);
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'activate', code: activateCode }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Activation failed');
      setConfigured(true);
      setSetupUrl(null);
      setSetupSecret(null);
      setActivateCode('');
      setMessage({ kind: 'ok', text: 'OTP activated. Adjustments now require a code from your app.' });
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/adjust-balance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), asset, amount: amount.trim(), direction, reason: reason.trim(), otp: otp.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Adjustment failed');
      setMessage({
        kind: 'ok',
        text: `${direction === 'credit' ? 'Credited' : 'Debited'} ${d.amount} ${d.asset} ${direction === 'credit' ? 'to' : 'from'} ${d.email}.`,
      });
      setAmount('');
      setReason('');
      setOtp('');
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    /\S+@\S+\.\S+/.test(email) && Number(amount) > 0 && reason.trim().length >= 3 && otp.replace(/\D/g, '').length >= 6 && !busy;

  const inputCls =
    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Adjust Balance</h1>
        <p className="text-gray-600 mt-2">
          Credit or debit a user&apos;s wallet. Every adjustment requires a one-time code from your
          authenticator app and is fully recorded on the ledger and audit trail.
        </p>
      </div>

      {message && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm max-w-xl ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {configured === null && <p className="text-gray-500">Loading…</p>}

      {/* ---- OTP setup ---- */}
      {configured === false && (
        <div className="max-w-xl bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-3">
            <KeyRound size={20} className="text-brand-600" />
            <h2 className="text-lg font-bold text-gray-900">Set up transaction OTP</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Balance adjustments are locked until you link an authenticator app (Google
            Authenticator, Authy, 1Password…). This takes one minute and only needs doing once.
          </p>

          {!setupUrl ? (
            <button
              onClick={beginSetup}
              disabled={busy}
              className="px-5 py-3 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Generating…' : 'Generate setup code'}
            </button>
          ) : (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">
                1. Scan this QR in your authenticator app
              </p>
              {/* Real white (not the themed bg-white token) so the QR scans. */}
              <div className="inline-block rounded-xl p-4 border border-gray-200" style={{ backgroundColor: '#ffffff' }}>
                <QRCodeSVG value={setupUrl} size={180} bgColor="#ffffff" fgColor="#000000" />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Can&apos;t scan? Enter this key manually:{' '}
                <code className="font-mono text-gray-700">{setupSecret}</code>
              </p>
              <p className="text-sm font-semibold text-gray-700 mt-5 mb-2">
                2. Enter the 6-digit code the app shows
              </p>
              <div className="flex gap-2">
                <input
                  value={activateCode}
                  onChange={(e) => setActivateCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="123456"
                  className={inputCls + ' max-w-[160px] font-mono text-lg tracking-widest'}
                />
                <button
                  onClick={activate}
                  disabled={activateCode.length !== 6 || busy}
                  className="px-5 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? 'Checking…' : 'Activate'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Adjustment form ---- */}
      {configured === true && (
        <div className="max-w-xl space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
            <div className="flex gap-2">
              <button
                onClick={() => setDirection('credit')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-semibold border ${
                  direction === 'credit'
                    ? 'bg-green-100 text-green-700 border-transparent'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <ArrowDownToLine size={16} /> Credit user
              </button>
              <button
                onClick={() => setDirection('debit')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-semibold border ${
                  direction === 'debit'
                    ? 'bg-red-100 text-red-700 border-transparent'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <ArrowUpFromLine size={16} /> Debit user
              </button>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">User email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Asset</label>
                <select value={asset} onChange={(e) => setAsset(e.target.value as (typeof ASSETS)[number])} className={inputCls}>
                  {ASSETS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Amount</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Reason (shown to the user)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Refund for failed bill payment TX-1234"
                maxLength={200}
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                OTP code from your authenticator app
              </label>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                className={inputCls + ' max-w-[180px] font-mono text-lg tracking-widest'}
              />
            </div>

            <button
              onClick={submit}
              disabled={!canSubmit}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold text-white disabled:opacity-50 ${
                direction === 'credit' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {busy ? 'Processing…' : direction === 'credit' ? 'Credit balance' : 'Debit balance'}
            </button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900 flex gap-2">
            <ShieldCheck size={18} className="shrink-0 mt-0.5" />
            <span>
              Each code works once. The user gets a notification with your reason, and every
              adjustment appears in their transaction history and the audit log.
            </span>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
