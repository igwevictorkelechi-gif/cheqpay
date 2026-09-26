'use client';

import React, { useEffect, useState } from 'react';
import { UserPlus, KeyRound, Trash2, Copy, Check, RefreshCw, X } from 'lucide-react';

type SubAdmin = {
  email: string;
  status: 'pending' | 'active' | 'no_password';
  createdAt: string | null;
  passwordChangedAt: string | null;
};

type Details = { email: string; password: string; url: string; reset: boolean };

// A strong starting password: 16 characters from an alphabet without
// look-alikes (0/O, 1/l/I), always with letters and digits.
function generatePassword(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => all[b % all.length]);
  chars[3] = digits[bytes[3] % digits.length];
  chars[9] = letters[bytes[9] % letters.length];
  return chars.join('');
}

const strongEnough = (p: string) => p.length >= 12 && /[A-Za-z]/.test(p) && /\d/.test(p);

const STATUS: Record<SubAdmin['status'], { label: string; cls: string }> = {
  pending: { label: 'Waiting for first sign-in', cls: 'bg-amber-100 text-amber-800' },
  active: { label: 'Active', cls: 'bg-green-100 text-green-700' },
  no_password: { label: 'No password set', cls: 'bg-gray-100 text-gray-600' },
};

/**
 * Sub admins: you set a starting password and hand over the login details;
 * they must set their own password on first sign-in, and can only see the
 * Dashboard and Analytics.
 */
export default function SubAdminsPanel({ onChanged }: { onChanged?: () => void }) {
  const [list, setList] = useState<SubAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const r = await fetch('/api/sub-admins', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not load sub admins');
      setList(Array.isArray(d.subAdmins) ? d.subAdmins : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startReset = (target: string) => {
    setResetFor(target);
    setEmail(target);
    setPassword(generatePassword());
    setDetails(null);
    setError(null);
  };

  const cancel = () => {
    setResetFor(null);
    setEmail('');
    setPassword('');
  };

  const submit = async () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setError('Enter a valid email.');
    if (!strongEnough(password)) return setError('Use at least 12 characters, with letters and numbers.');
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/sub-admins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: e, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not save');
      setList(Array.isArray(d.subAdmins) ? d.subAdmins : list);
      setDetails({ email: e, password, url: window.location.origin + '/login', reset: !!resetFor });
      setCopied(false);
      cancel();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (target: string) => {
    if (!window.confirm(`Remove ${target}? They will lose access immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/sub-admins', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: target }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not remove');
      setList(Array.isArray(d.subAdmins) ? d.subAdmins : list.filter((s) => s.email !== target));
      if (details?.email === target) setDetails(null);
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const detailsText = details
    ? [
        'CheqPay admin dashboard — your sub admin login',
        '',
        `Sign in at: ${details.url}`,
        `Email: ${details.email}`,
        `Starting password: ${details.password}`,
        '',
        "You'll be asked to set your own password when you first sign in.",
        'You can view the Dashboard and Analytics.',
      ].join('\n')
    : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detailsText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-1">
        <UserPlus size={20} className="text-brand-600" />
        <h2 className="text-lg font-bold text-gray-900">Sub admins</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Give someone their own login. You set a starting password; they must set their own the first
        time they sign in. Sub admins can only view the Dashboard and Analytics.
      </p>

      {details && (
        <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-brand-800">
              {details.reset ? 'Password reset — send these new details' : 'Sub admin added — send these login details'}
            </p>
            <button onClick={() => setDetails(null)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-white p-3 text-sm text-gray-800 border border-brand-100">
            {detailsText}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy details'}
            </button>
            <span className="text-xs text-gray-500">
              This password is shown only once. Send it privately, not in a group chat.
            </span>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 mb-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">
          {resetFor ? `Reset password for ${resetFor}` : 'Add a sub admin'}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!!resetFor}
            type="email"
            placeholder="name@mycheqpay.com"
            autoComplete="off"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-100"
          />
          <div className="flex flex-1 gap-2">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="text"
              placeholder="Starting password"
              autoComplete="new-password"
              spellCheck={false}
              className="min-w-0 flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              onClick={() => setPassword(generatePassword())}
              title="Generate a strong password"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={14} /> Generate
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">At least 12 characters, with letters and numbers.</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            {resetFor ? <KeyRound size={16} /> : <UserPlus size={16} />}
            {busy ? 'Saving…' : resetFor ? 'Reset password' : 'Add sub admin'}
          </button>
          {resetFor && (
            <button onClick={cancel} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-400">No sub admins yet.</p>
      ) : (
        <div className="space-y-2">
          {list.map((s) => (
            <div
              key={s.email}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 rounded-lg bg-gray-50 border border-gray-100"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-gray-800">{s.email}</p>
                <span className={'mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ' + STATUS[s.status].cls}>
                  {STATUS[s.status].label}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => startReset(s.email)}
                  className="inline-flex items-center gap-1 text-sm text-brand-700 hover:text-brand-800"
                >
                  <KeyRound size={14} /> {s.status === 'no_password' ? 'Set password' : 'Reset password'}
                </button>
                <button
                  onClick={() => removeOne(s.email)}
                  disabled={busy}
                  className="text-red-500 hover:text-red-700"
                  aria-label={`Remove ${s.email}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
