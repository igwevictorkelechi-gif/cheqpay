'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard } from 'lucide-react';

type Card = {
  id: string;
  currency: string;
  brand: string | null;
  maskedPan: string | null;
  status: string;
  createdAt: string;
};

type Pricing = {
  cardIssueFeeUsd: number;
  cardFundMinUsd: number;
  cardFundFeeSmallUsd: number;
  cardFundFeeLargeBps: number;
  cardFundThresholdUsd: number;
};

/** GET /api/users/{id}/cards */
type CardsInfo = {
  cards: Card[];
  enrolled: boolean;
  /** Maplerad issues cards only from tier 2. */
  mapleradTier: number;
  active: boolean;
  issuingConfigured: boolean;
  hasPaidSlot: boolean;
  usdAvailable: string;
  pricing: Pricing;
};

const QUICK = ['5', '10', '25', '50', '100'];

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-800',
  unfunded: 'bg-gray-100 text-gray-700',
  activating: 'bg-amber-100 text-amber-800',
  frozen: 'bg-blue-100 text-blue-800',
};

const STATUS_LABEL: Record<string, string> = {
  unfunded: 'Fee paid, not created',
  activating: 'Being created',
  pending: 'Waiting for Maplerad',
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * What a new card costs, in cents: the same rules as the server's cardFundFee
 * and cardIssueFee, so the admin sees the exact charge before confirming.
 */
function breakdown(amount: string, info: CardsInfo) {
  if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) return null;
  const p = info.pricing;
  const topUp = Math.round(Number(amount) * 100);
  const belowMin = topUp < Math.round(p.cardFundMinUsd * 100);
  const topUpFee =
    topUp >= Math.round(p.cardFundThresholdUsd * 100)
      ? Math.floor((topUp * p.cardFundFeeLargeBps) / 10_000)
      : Math.round(p.cardFundFeeSmallUsd * 100);
  const cardFee = info.hasPaidSlot ? 0 : Math.round(p.cardIssueFeeUsd * 100);
  const total = cardFee + topUp + topUpFee;
  const balance = Math.round(Number(info.usdAvailable) * 100);
  return { topUp, topUpFee, cardFee, total, balance, belowMin, enough: balance >= total };
}

/**
 * The user's virtual cards, and a way for an admin to create one for them.
 * The card is paid from the user's own USD balance, at the same prices as in
 * the app; the backend asks for a reason and an authenticator code.
 */
export default function UserCardsPanel({ userId }: { userId: string }) {
  const [info, setInfo] = useState<CardsInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState('10');
  const [reason, setReason] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetch(`/api/users/${userId}/cards`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not load cards');
      setInfo(d as CardsInfo);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cost = useMemo(() => (info ? breakdown(amount, info) : null), [amount, info]);

  const blocker = !info
    ? null
    : !info.issuingConfigured
      ? 'Card issuing isn’t configured on this deployment.'
      : !info.active
        ? 'This account isn’t active, so it can’t get a card.'
        : !info.enrolled
          ? 'Enrol the user with Maplerad first (Enrol / upgrade tier above).'
          : info.mapleradTier < 2
            ? `Maplerad only issues cards at tier 2, and this user is at tier ${info.mapleradTier}. Use Enrol / upgrade tier above first.`
            : null;

  const canCreate =
    !!info &&
    !blocker &&
    !!cost &&
    !cost.belowMin &&
    cost.enough &&
    reason.trim().length >= 10 &&
    /^\d{6}$/.test(otp.trim()) &&
    !busy;

  async function create() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch(`/api/users/${userId}/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: amount.trim(), reason: reason.trim(), otp: otp.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not create the card');
      setResult({ ok: true, text: d.message });
      setReason('');
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setOtp('');
      setBusy(false);
      void load();
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Virtual cards</h2>
      <p className="mt-1 text-sm text-gray-500">
        Create a USD virtual card for this user. It is paid from their own USD balance, with the same
        fees as in the app. If Maplerad doesn’t create the card, the money goes back to them.
      </p>

      {loadError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</div>
      )}

      {info && (
        <>
          {/* Their cards */}
          <div className="mt-4">
            {info.cards.length === 0 ? (
              <p className="text-sm text-gray-500">No cards yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {info.cards.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CreditCard className="h-5 w-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {c.brand ?? 'VISA'} {c.currency} · {c.maskedPan ?? 'not created yet'}
                        </p>
                        <p className="text-xs text-gray-500">{new Date(c.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status] ?? 'bg-gray-100 text-gray-700'}`}
                    >
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Create one */}
          <div className="mt-6 border-t border-gray-200 pt-6">
            <h3 className="text-sm font-semibold text-gray-900">Create a card for this user</h3>
            {blocker ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{blocker}</p>
            ) : (
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                    First top-up on the card (USD)
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                      inputMode="decimal"
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {QUICK.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setAmount(q)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${amount === q ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                      >
                        ${q}
                      </button>
                    ))}
                  </div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                    Reason (kept in the audit log)
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value.slice(0, 200))}
                      placeholder="e.g. Asked for it on support chat, ticket 1042"
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none"
                    />
                  </label>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                    Authenticator code
                    <input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      placeholder="6 digits"
                      className="mt-1 block w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm tracking-widest text-gray-900 focus:border-brand-500 focus:outline-none"
                    />
                  </label>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                  {!cost ? (
                    <p className="text-gray-500">Enter an amount like 10 or 10.50.</p>
                  ) : (
                    <dl className="space-y-1.5">
                      <Row label="Loaded on the card" value={money(cost.topUp)} />
                      <Row label="Top-up fee" value={money(cost.topUpFee)} />
                      <Row
                        label="Card fee"
                        value={info.hasPaidSlot ? 'Already paid' : money(cost.cardFee)}
                      />
                      <div className="my-2 border-t border-gray-200" />
                      <Row label="Taken from their USD balance" value={money(cost.total)} strong />
                      <Row label="Their USD balance" value={money(cost.balance)} />
                    </dl>
                  )}
                  {cost?.belowMin && (
                    <p className="mt-3 text-xs text-red-600">
                      The smallest card top-up is ${info.pricing.cardFundMinUsd.toFixed(2)}.
                    </p>
                  )}
                  {cost && !cost.belowMin && !cost.enough && (
                    <p className="mt-3 text-xs text-red-600">
                      Their USD balance doesn’t cover this card. Try a smaller top-up.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={create}
                    disabled={!canCreate}
                    className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? 'Creating…' : cost && !cost.belowMin ? `Create card · charge ${money(cost.total)}` : 'Create card'}
                  </button>
                  <p className="mt-2 text-xs text-gray-500">The user gets a notification saying what was charged.</p>
                </div>
              </div>
            )}

            {result && (
              <div
                className={`mt-4 rounded-lg border p-3 text-sm ${result.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}
              >
                {result.text}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? 'font-semibold text-gray-900' : 'text-gray-600'}>{label}</dt>
      <dd className={strong ? 'font-semibold text-gray-900' : 'text-gray-900'}>{value}</dd>
    </div>
  );
}
