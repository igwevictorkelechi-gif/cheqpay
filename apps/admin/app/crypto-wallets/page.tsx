'use client';

import React, { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Wallet, ShieldAlert, CheckCircle2, Coins, Loader2 } from 'lucide-react';

type Sym = 'BTC' | 'USDT' | 'USDC';
type Entry = { address: string; networkLabel: string; network: string };

const ASSETS: { sym: Sym; name: string; color: string; defaultNetwork: string; defaultLabel: string }[] = [
  { sym: 'BTC', name: 'Bitcoin', color: '#F7931A', defaultNetwork: 'BITCOIN', defaultLabel: 'Bitcoin' },
  { sym: 'USDT', name: 'Tether', color: '#26A17B', defaultNetwork: 'TRON', defaultLabel: 'Tron (TRC-20)' },
  { sym: 'USDC', name: 'USD Coin', color: '#2775CA', defaultNetwork: 'ETHEREUM', defaultLabel: 'Ethereum (ERC-20)' },
];

const NETWORKS = ['BITCOIN', 'TRON', 'ETHEREUM', 'BSC'];

export default function CryptoWalletsPage() {
  const [wallets, setWallets] = useState<Record<Sym, Entry | null>>({
    BTC: null,
    USDT: null,
    USDC: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual credit form
  const [creditEmail, setCreditEmail] = useState('');
  const [creditAsset, setCreditAsset] = useState<Sym>('USDT');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditTxHash, setCreditTxHash] = useState('');
  const [crediting, setCrediting] = useState(false);
  const [creditMsg, setCreditMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/crypto-wallets')
      .then((r) => r.json())
      .then((d) => {
        if (d.wallets) {
          setWallets((prev) => ({ ...prev, ...d.wallets }));
        }
      })
      .catch(() => setError('Could not load wallet settings.'))
      .finally(() => setLoading(false));
  }, []);

  const setField = (sym: Sym, field: keyof Entry, value: string) => {
    setSaved(false);
    setWallets((prev) => {
      const meta = ASSETS.find((a) => a.sym === sym)!;
      const cur = prev[sym] ?? {
        address: '',
        networkLabel: meta.defaultLabel,
        network: meta.defaultNetwork,
      };
      return { ...prev, [sym]: { ...cur, [field]: value } };
    });
  };

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Only send entries with an address; empty address disables the asset.
      const payload: Record<string, Entry | null> = {};
      for (const a of ASSETS) {
        const e = wallets[a.sym];
        payload[a.sym] = e && e.address.trim().length >= 15 ? e : null;
      }
      const res = await fetch('/api/crypto-wallets', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function credit() {
    setCrediting(true);
    setCreditMsg(null);
    try {
      const res = await fetch('/api/credit-crypto', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: creditEmail.trim(),
          asset: creditAsset,
          amount: creditAmount.trim(),
          txHash: creditTxHash.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Credit failed');
      setCreditMsg({
        ok: true,
        text: data.duplicate
          ? 'Already credited for this transaction hash (no double credit).'
          : `Credited ${creditAmount} ${creditAsset} to ${creditEmail}.`,
      });
      if (!data.duplicate) {
        setCreditAmount('');
        setCreditTxHash('');
      }
    } catch (e) {
      setCreditMsg({ ok: false, text: e instanceof Error ? e.message : 'Credit failed' });
    } finally {
      setCrediting(false);
    }
  }

  const canCredit =
    /\S+@\S+\.\S+/.test(creditEmail) &&
    /^\d+(\.\d+)?$/.test(creditAmount) &&
    creditTxHash.trim().length >= 8 &&
    !crediting;

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Crypto Wallets</h1>
        <p className="text-gray-600 mt-2">
          Manual custody — set the business deposit address per asset. Users see these on
          Receive; leave an address empty to show that asset as “Coming soon”.
        </p>
      </div>

      <div className="mb-6 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <span>
          Deposits to these shared addresses are <b>not auto-credited</b>. When a user’s deposit
          confirms on-chain, credit it below with the transaction hash — the hash is the
          duplicate-protection key. Crypto withdrawals queue under{' '}
          <b>Transactions → held withdrawals</b>: send the funds from your wallet first, then
          approve with the payout hash.
        </span>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          {ASSETS.map((a) => {
            const e = wallets[a.sym];
            return (
              <div key={a.sym} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-5">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full text-white font-bold"
                    style={{ backgroundColor: a.color }}
                  >
                    {a.sym[0]}
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">{a.name} ({a.sym})</h2>
                    <p className="text-sm text-gray-500">
                      {e?.address ? 'Live — users can deposit' : 'Not set — shows as Coming soon'}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Deposit address</label>
                    <input
                      value={e?.address ?? ''}
                      onChange={(ev) => setField(a.sym, 'address', ev.target.value)}
                      placeholder={`Your ${a.sym} wallet address`}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-brand-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Network</label>
                    <div className="flex gap-2">
                      <select
                        value={e?.network ?? a.defaultNetwork}
                        onChange={(ev) => setField(a.sym, 'network', ev.target.value)}
                        className="rounded-lg border border-gray-300 px-2 py-2.5 text-sm focus:outline-none"
                      >
                        {NETWORKS.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      <input
                        value={e?.networkLabel ?? a.defaultLabel}
                        onChange={(ev) => setField(a.sym, 'networkLabel', ev.target.value)}
                        placeholder="Shown to users"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              style={{ backgroundColor: '#6B5B95' }}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
              {saving ? 'Saving…' : 'Save wallets'}
            </button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-green-600">
                <CheckCircle2 size={16} /> Saved — live for users now
              </span>
            )}
          </div>

          {/* Manual deposit credit */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 rounded-lg bg-green-100 text-green-600"><Coins size={20} /></div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Credit a deposit</h2>
                <p className="text-sm text-gray-500">
                  A user sent crypto to your wallet — credit their CheqPay balance.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">User email</label>
                <input
                  value={creditEmail}
                  onChange={(e) => setCreditEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Asset</label>
                <select
                  value={creditAsset}
                  onChange={(e) => setCreditAsset(e.target.value as Sym)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-2.5 text-sm focus:outline-none"
                >
                  {ASSETS.map((a) => (
                    <option key={a.sym} value={a.sym}>{a.sym}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount</label>
                <input
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>
              <div className="md:col-span-4">
                <label className="block text-xs text-gray-500 mb-1">
                  On-chain transaction hash (duplicate-protection key)
                </label>
                <input
                  value={creditTxHash}
                  onChange={(e) => setCreditTxHash(e.target.value)}
                  placeholder="Transaction hash from the block explorer"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:outline-none"
                />
              </div>
            </div>
            {creditMsg && (
              <p className={`mt-3 text-sm ${creditMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
                {creditMsg.text}
              </p>
            )}
            <button
              onClick={credit}
              disabled={!canCredit}
              className="mt-4 inline-flex items-center gap-2 rounded-lg px-6 py-2.5 font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#16A34A' }}
            >
              {crediting ? <Loader2 size={16} className="animate-spin" /> : <Coins size={16} />}
              {crediting ? 'Crediting…' : 'Credit user'}
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
