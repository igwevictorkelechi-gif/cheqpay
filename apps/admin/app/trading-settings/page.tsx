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
  CreditCard,
  Scale,
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

/** The price sheet (mirrors Pricing in apps/api/src/lib/settings.ts). */
interface Pricing {
  depositFeeCapNgn: number;
  usdDepositFeeBps: number;
  usdDepositLargeFeeBps: number;
  usdDepositLargeThresholdUsd: number;
  cryptoDepositFeeBps: number;
  cryptoWithdrawalFeeUsd: number;
  cardIssueFeeUsd: number;
  cardFundMinUsd: number;
  cardFundFeeSmallUsd: number;
  cardFundFeeLargeBps: number;
  cardFundThresholdUsd: number;
  cardWithdrawFeeUsd: number;
}
type PricingKey = keyof Pricing;

/** Inputs for the price sheet, grouped as they appear on the page. */
const PRICING_FIELDS: { group: string; fields: { key: PricingKey; label: string; unit: 'bps' | '₦' | '$'; hint: string }[] }[] = [
  {
    group: 'Deposits',
    fields: [
      { key: 'depositFeeCapNgn', label: 'Naira deposit fee cap', unit: '₦', hint: 'Most a Naira deposit fee can be. Maplerad caps theirs at ₦500. 0 = no cap.' },
      { key: 'usdDepositFeeBps', label: 'USD bank deposit fee', unit: 'bps', hint: 'Below the threshold. Maplerad charges us 3%.' },
      { key: 'usdDepositLargeFeeBps', label: 'USD bank deposit fee (large)', unit: 'bps', hint: 'At or above the threshold. Maplerad charges us 1.5%.' },
      { key: 'usdDepositLargeThresholdUsd', label: 'Large USD deposit threshold', unit: '$', hint: 'Maplerad’s lower rate starts at $25,000.' },
      { key: 'cryptoDepositFeeBps', label: 'Stablecoin → USD deposit fee', unit: 'bps', hint: 'Coins that land as dollars. Maplerad’s ramp costs 0.5%.' },
    ],
  },
  {
    group: 'Crypto withdrawals',
    fields: [
      { key: 'cryptoWithdrawalFeeUsd', label: 'Network fee per withdrawal', unit: '$', hint: 'Charged in the coin at the live price, out of the amount sent. Costs us $1.50–$2 plus gas.' },
    ],
  },
  {
    group: 'USD virtual cards',
    fields: [
      { key: 'cardIssueFeeUsd', label: 'Card price', unit: '$', hint: 'Paid from the USD wallet when the card is requested. Maplerad charges us $2.' },
      { key: 'cardFundMinUsd', label: 'Smallest top-up', unit: '$', hint: 'Top-ups below this are refused.' },
      { key: 'cardFundFeeSmallUsd', label: 'Top-up fee (below threshold)', unit: '$', hint: 'Flat, added on top. Maplerad charges us $1 under $100.' },
      { key: 'cardFundFeeLargeBps', label: 'Top-up fee (from threshold)', unit: 'bps', hint: 'Added on top. Maplerad charges us 2% from $100.' },
      { key: 'cardFundThresholdUsd', label: 'Top-up fee threshold', unit: '$', hint: 'Where the fee switches from flat to percentage. Maplerad’s is $100.' },
      { key: 'cardWithdrawFeeUsd', label: 'Card withdrawal fee', unit: '$', hint: 'Out of the amount moved back to the wallet. Maplerad charges us $1.' },
    ],
  },
];

/**
 * What Maplerad charges us for each thing we price (SLA Schedule 2), so the
 * page can show the margin and flag anything sold below cost.
 */
function costRows(s: {
  depositFeeBps: number;
  withdrawalFeeNgn: number;
  /** Effective spread per kind of swap: buy, sell, convert. */
  swap: [number, number, number];
  fxBuyBps: number;
  fxSellBps: number;
  p: Pricing;
}) {
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return [
    { what: 'Naira deposit', cost: '0.5% (max ₦500)', price: `${pct(s.depositFeeBps)} (max ₦${s.p.depositFeeCapNgn.toLocaleString()})`, below: s.depositFeeBps < 50 || (s.p.depositFeeCapNgn > 0 && s.p.depositFeeCapNgn < 500) },
    { what: 'Naira withdrawal', cost: '₦20', price: `₦${s.withdrawalFeeNgn.toLocaleString()}`, below: s.withdrawalFeeNgn < 20 },
    { what: 'USD bank deposit', cost: '3% / 1.5% from $25k', price: `${pct(s.p.usdDepositFeeBps)} / ${pct(s.p.usdDepositLargeFeeBps)}`, below: s.p.usdDepositFeeBps < 300 || s.p.usdDepositLargeFeeBps < 150 },
    { what: 'Stablecoin → USD', cost: '0.5%', price: pct(s.p.cryptoDepositFeeBps), below: s.p.cryptoDepositFeeBps < 50 },
    { what: 'Crypto buy / sell / convert', cost: '0.5% ramp', price: s.swap.map(pct).join(' / '), below: s.swap.some((b) => b < 50) },
    { what: 'Naira ⇄ Dollar', cost: 'inside Maplerad’s rate', price: `${pct(s.fxBuyBps)} / ${pct(s.fxSellBps)}`, below: s.fxBuyBps <= 0 || s.fxSellBps <= 0 },
    { what: 'Crypto withdrawal', cost: '$1.50–$2 + gas', price: usd(s.p.cryptoWithdrawalFeeUsd), below: s.p.cryptoWithdrawalFeeUsd < 2 },
    { what: 'Card', cost: '$2', price: usd(s.p.cardIssueFeeUsd), below: s.p.cardIssueFeeUsd < 2 },
    { what: 'Card top-up', cost: '$1 / 2% from $100', price: `${usd(s.p.cardFundFeeSmallUsd)} / ${pct(s.p.cardFundFeeLargeBps)}`, below: s.p.cardFundFeeSmallUsd < 1 || s.p.cardFundFeeLargeBps < 200 },
    { what: 'Card withdrawal', cost: '$1', price: usd(s.p.cardWithdrawFeeUsd), below: s.p.cardWithdrawFeeUsd < 1 },
  ];
}

/** Per service: a number is its own rate; null means it uses the default. */
type BillMargins = Record<BillService, number | null>;

type SwapKind = 'buy' | 'sell' | 'convert';
const SWAP_KINDS: { key: SwapKind; label: string; hint: string }[] = [
  { key: 'buy', label: 'Buying crypto with Naira', hint: 'Users pay Maplerad’s rate plus this.' },
  { key: 'sell', label: 'Selling crypto for Naira', hint: 'Users get Maplerad’s rate minus this.' },
  { key: 'convert', label: 'USD ⇄ USDT and crypto ⇄ crypto', hint: 'No Naira involved.' },
];

interface Settings {
  spreadBps: number;
  swapSpreads: Record<SwapKind, number | null>;
  usdtNgnRate: number | null;
  usdtNgnRateSource: 'maplerad' | 'manual';
  cryptoSettlement?: 'maplerad' | 'ledger';
  usdtNgnRateUpdatedAt: string | null;
  usdtNgnRateUpdatedBy: string | null;
  depositFeeBps: number;
  withdrawalFeeNgn: number;
  fxMarginBps: number;
  fxMargins: { buyUsd: number | null; sellUsd: number | null };
  withdrawalMinNgn: number;
  withdrawalMinUsd: number;
  depositMinUsd: number;
  billMarginBps: number;
  billMargins: BillMargins;
  cashbackEnabled: boolean;
  cashbackDepositBps: number;
  cashbackWithdrawalBps: number;
  cashbackBillBps: number;
  cashbackTradeBps: number;
  cashbackMaxNgn: number;
  pricing: Pricing;
}

/** "3 min ago" from an ISO time. */
function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : new Date(iso).toLocaleString();
}

export default function TradingSettingsPage() {
  const [spreadBps, setSpreadBps] = useState('');
  // '' means "uses the shared spread", distinct from '0', which is free.
  const [swapSpreads, setSwapSpreads] = useState<Record<SwapKind, string>>({ buy: '', sell: '', convert: '' });
  const [usdtNgnRate, setUsdtNgnRate] = useState('');
  const [usdtSource, setUsdtSource] = useState<'maplerad' | 'manual'>('maplerad');
  const [settlement, setSettlement] = useState<'maplerad' | 'ledger'>('maplerad');
  const [usdtUpdated, setUsdtUpdated] = useState<{ at: string | null; by: string | null }>({ at: null, by: null });
  const [depositFeeBps, setDepositFeeBps] = useState('');
  const [withdrawalFeeNgn, setWithdrawalFeeNgn] = useState('');
  const [fxMarginBps, setFxMarginBps] = useState('');
  const [fxBuyUsd, setFxBuyUsd] = useState('');
  const [fxSellUsd, setFxSellUsd] = useState('');
  const [withdrawalMinNgn, setWithdrawalMinNgn] = useState('');
  const [withdrawalMinUsd, setWithdrawalMinUsd] = useState('');
  const [depositMinUsd, setDepositMinUsd] = useState('');
  const [billMarginBps, setBillMarginBps] = useState('');
  // '' means "uses the default" — distinct from '0', which pins face value.
  const [billMargins, setBillMargins] = useState<Record<string, string>>({});
  const [cashbackEnabled, setCashbackEnabled] = useState(false);
  const [cashbackDepositBps, setCashbackDepositBps] = useState('');
  const [cashbackWithdrawalBps, setCashbackWithdrawalBps] = useState('');
  const [cashbackBillBps, setCashbackBillBps] = useState('');
  const [cashbackTradeBps, setCashbackTradeBps] = useState('');
  const [cashbackMaxNgn, setCashbackMaxNgn] = useState('');
  const [pricing, setPricing] = useState<Record<PricingKey, string>>({} as Record<PricingKey, string>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function applySnapshot(data: Settings) {
    setSpreadBps(String(data.spreadBps ?? ''));
    setSwapSpreads({
      buy: data.swapSpreads?.buy == null ? '' : String(data.swapSpreads.buy),
      sell: data.swapSpreads?.sell == null ? '' : String(data.swapSpreads.sell),
      convert: data.swapSpreads?.convert == null ? '' : String(data.swapSpreads.convert),
    });
    setUsdtNgnRate(data.usdtNgnRate != null ? String(data.usdtNgnRate) : '');
    setUsdtSource(data.usdtNgnRateSource === 'manual' ? 'manual' : 'maplerad');
    setSettlement(data.cryptoSettlement === 'ledger' ? 'ledger' : 'maplerad');
    setUsdtUpdated({ at: data.usdtNgnRateUpdatedAt ?? null, by: data.usdtNgnRateUpdatedBy ?? null });
    setDepositFeeBps(String(data.depositFeeBps ?? 0));
    setWithdrawalFeeNgn(String(data.withdrawalFeeNgn ?? 0));
    setFxMarginBps(String(data.fxMarginBps ?? 0));
    setFxBuyUsd(data.fxMargins?.buyUsd == null ? '' : String(data.fxMargins.buyUsd));
    setFxSellUsd(data.fxMargins?.sellUsd == null ? '' : String(data.fxMargins.sellUsd));
    setWithdrawalMinNgn(String(data.withdrawalMinNgn ?? 0));
    setWithdrawalMinUsd(String(data.withdrawalMinUsd ?? 0));
    setDepositMinUsd(String(data.depositMinUsd ?? 0));
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
    if (data.pricing) {
      setPricing(
        Object.fromEntries(
          Object.entries(data.pricing).map(([k, v]) => [k, String(v)]),
        ) as Record<PricingKey, string>,
      );
    }
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
      // A blank box clears that kind back to the shared spread.
      payload.swapSpreads = Object.fromEntries(
        SWAP_KINDS.map(({ key }) => [key, swapSpreads[key] === '' ? null : Number(swapSpreads[key])]),
      );
      payload.usdtNgnRateSource = usdtSource;
      payload.cryptoSettlement = settlement;
      // While following Maplerad the box only shows the live rate; sending it
      // back would just restamp it as typed in.
      if (usdtSource === 'manual' && usdtNgnRate !== '') payload.usdtNgnRate = Number(usdtNgnRate);
      if (depositFeeBps !== '') payload.depositFeeBps = Number(depositFeeBps);
      if (withdrawalFeeNgn !== '') payload.withdrawalFeeNgn = Number(withdrawalFeeNgn);
      if (billMarginBps !== '') payload.billMarginBps = Number(billMarginBps);
      if (fxMarginBps !== '') payload.fxMarginBps = Number(fxMarginBps);
      // Blank clears a side back to the shared spread; '0' is a real rate.
      payload.fxMargins = {
        buyUsd: fxBuyUsd === '' ? null : Number(fxBuyUsd),
        sellUsd: fxSellUsd === '' ? null : Number(fxSellUsd),
      };
      if (withdrawalMinNgn !== '') payload.withdrawalMinNgn = Number(withdrawalMinNgn);
      if (withdrawalMinUsd !== '') payload.withdrawalMinUsd = Number(withdrawalMinUsd);
      if (depositMinUsd !== '') payload.depositMinUsd = Number(depositMinUsd);
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
      payload.pricing = Object.fromEntries(
        Object.entries(pricing)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => [k, Number(v)]),
      );

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
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-sm font-medium text-gray-700">Per kind of swap</p>
            <p className="text-xs text-gray-500 mt-1 mb-3">
              Leave a box empty to use the spread above. Keep &ldquo;Selling crypto for Naira&rdquo; equal to
              Dollar → Naira below, or one route pays users more than the other.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SWAP_KINDS.map(({ key, label, hint }) => {
                const raw = swapSpreads[key];
                return (
                  <div key={key}>
                    <label htmlFor={`swap-${key}`} className="block text-xs font-medium text-gray-600 mb-1">
                      {label}
                    </label>
                    <input
                      id={`swap-${key}`}
                      type="number"
                      min={0}
                      max={1000}
                      step={1}
                      value={raw}
                      onChange={(e) => setSwapSpreads((m) => ({ ...m, [key]: e.target.value }))}
                      disabled={loading || saving}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={`shared (${pct(spreadBps)}%)`}
                    />
                    <p className="text-[11px] text-gray-400 mt-1">
                      {raw === '' ? `Using shared · ${pct(spreadBps)}%` : `${pct(raw)}%`} · {hint}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <DollarSign size={18} className="text-brand-600" />
            Business USDT&rarr;NGN rate
          </label>
          <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={usdtSource === 'maplerad'}
              onChange={(e) => setUsdtSource(e.target.checked ? 'maplerad' : 'manual')}
              disabled={loading || saving}
            />
            Follow Maplerad&apos;s live dollar rate
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={usdtNgnRate}
            onChange={(e) => setUsdtNgnRate(e.target.value)}
            disabled={loading || saving || usdtSource === 'maplerad'}
            className={inputCls}
            placeholder="e.g. 1750"
          />
          <p className="text-sm text-gray-500 mt-2">
            Naira per 1 USDT before the swap spread. The crypto leg comes from Binance.
          </p>
          {usdtSource === 'maplerad' ? (
            <p className="text-sm text-gray-500 mt-1">
              Set automatically to what Maplerad pays per $1, refreshed every 10 minutes
              {usdtUpdated.at ? <> (last set {timeAgo(usdtUpdated.at)}{usdtUpdated.by ? ` by ${usdtUpdated.by}` : ''})</> : null}.
              A move of more than 5% at once is not followed: you get an alert, and the rate stays
              put until you confirm it by switching this off and typing the new rate.
            </p>
          ) : (
            <p className="text-sm text-amber-700 mt-1">
              Typed in: it will not move with Maplerad. Keep it at or below what Maplerad pays per $1, or
              crypto sales lose money.
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <DollarSign size={18} className="text-brand-600" />
            Back USDT &amp; USDC trades at Maplerad
          </label>
          <label className="mb-2 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settlement === 'maplerad'}
              onChange={(e) => setSettlement(e.target.checked ? 'maplerad' : 'ledger')}
              disabled={loading || saving}
            />
            Buy and sell the dollars behind every naira ⇄ USDT/USDC trade at Maplerad
          </label>
          {settlement === 'maplerad' ? (
            <p className="text-sm text-gray-500">
              When a customer buys USDT or USDC with naira, their naira is exchanged for dollars at Maplerad (which keeps
              stablecoins as dollars), and a sale does the reverse — so your Maplerad wallets always hold what customers
              own. Prices come from Maplerad&apos;s live exchange rate less the buy/sell spread above. If Maplerad
              refuses an exchange (for example, naira exchanges aren&apos;t enabled on your account), that trade is
              declined and the customer isn&apos;t charged.
            </p>
          ) : (
            <p className="text-sm text-amber-700">
              Off: USDT and USDC trades only change CheqPay&apos;s own balances. Nothing is bought at Maplerad, so your
              wallets there will not cover what customers hold — a customer sending USDT out can fail.
            </p>
          )}
          <p className="text-sm text-gray-500 mt-1">
            Naira ⇄ dollar conversions are always settled at Maplerad. BTC can&apos;t be: Maplerad doesn&apos;t hold it.
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
            Taken from each Naira deposit before crediting ({pct(depositFeeBps)}%), up to the cap
            below. Maplerad charges us 0.5% (max ₦500). Max 500 bps (5%). Set 0 for free deposits.
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
            Taken out of each bank payout: the user withdraws ₦100,000, the bank receives ₦100,000
            minus this fee. Maplerad charges us ₦20 per payout. Set 0 for free withdrawals.
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
            The fallback spread ({pct(fxMarginBps)}%), used by either side below that has no rate
            of its own. This rail is priced by Maplerad, so the trading spread above never reaches
            it — at 0 the provider&apos;s raw rate goes straight to the user and the business earns
            nothing. Max 1000 bps (10%).
          </p>

          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="text-sm font-semibold text-gray-700">The two sides</p>
            <p className="text-xs text-gray-500 mt-1 mb-3">
              Named from your side of the trade. Leave a box empty to use the fallback. Setting a
              wider <span className="font-medium">sell</span> than{' '}
              <span className="font-medium">buy</span> means dollars leave dearer than they arrive
              — the usual shape when dollars are the scarce side.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="fx-buy" className="block text-xs font-medium text-gray-600 mb-1">
                  You buy $ (user sells)
                </label>
                <input
                  id="fx-buy"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={fxBuyUsd}
                  onChange={(e) => setFxBuyUsd(e.target.value)}
                  disabled={loading || saving}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder={`default (${pct(fxMarginBps)}%)`}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  {fxBuyUsd === ''
                    ? `Using default · ${pct(fxMarginBps)}%`
                    : `${pct(fxBuyUsd)}% below mid`}
                </p>
              </div>
              <div>
                <label htmlFor="fx-sell" className="block text-xs font-medium text-gray-600 mb-1">
                  You sell $ (user buys)
                </label>
                <input
                  id="fx-sell"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={fxSellUsd}
                  onChange={(e) => setFxSellUsd(e.target.value)}
                  disabled={loading || saving}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder={`default (${pct(fxMarginBps)}%)`}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  {fxSellUsd === ''
                    ? `Using default · ${pct(fxMarginBps)}%`
                    : `${pct(fxSellUsd)}% above mid`}
                </p>
              </div>
            </div>
          </div>
        </div>

        <h2 className="text-lg font-bold text-gray-900 pt-2">Maplerad costs, passed on</h2>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          <p className="text-sm text-gray-500">
            Each of these is Maplerad&apos;s charge to us plus our margin. Users see every one of them
            on the Pricing page and before they confirm.
          </p>
          {PRICING_FIELDS.map(({ group, fields }) => (
            <div key={group}>
              <p className="flex items-center gap-2 text-gray-700 font-semibold mb-3">
                <CreditCard size={18} className="text-brand-600" />
                {group}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {fields.map(({ key, label, unit, hint }) => (
                  <div key={key}>
                    <label htmlFor={`p-${key}`} className="block text-sm font-semibold text-gray-700 mb-1.5">
                      {label} ({unit === 'bps' ? 'basis points' : unit})
                    </label>
                    <input
                      id={`p-${key}`}
                      type="number"
                      min={0}
                      step={unit === 'bps' ? 1 : 0.01}
                      value={pricing[key] ?? ''}
                      onChange={(e) => setPricing((p) => ({ ...p, [key]: e.target.value }))}
                      disabled={loading || saving}
                      className={inputCls}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {unit === 'bps' && pricing[key] ? `${pct(pricing[key])}% · ` : ''}
                      {hint}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Cost vs price: every fee next to what it costs us. */}
        {!loading && pricing.cardIssueFeeUsd !== undefined && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <p className="flex items-center gap-2 text-gray-700 font-semibold mb-3">
              <Scale size={18} className="text-brand-600" />
              Cost vs price
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 font-medium">Service</th>
                  <th className="py-1 font-medium">Maplerad charges us</th>
                  <th className="py-1 font-medium">User pays</th>
                </tr>
              </thead>
              <tbody>
                {costRows({
                  depositFeeBps: Number(depositFeeBps || 0),
                  withdrawalFeeNgn: Number(withdrawalFeeNgn || 0),
                  swap: SWAP_KINDS.map(({ key }) =>
                    Number(swapSpreads[key] === '' ? spreadBps || 0 : swapSpreads[key]),
                  ) as [number, number, number],
                  fxBuyBps: Number(fxBuyUsd === '' ? fxMarginBps || 0 : fxBuyUsd),
                  fxSellBps: Number(fxSellUsd === '' ? fxMarginBps || 0 : fxSellUsd),
                  p: Object.fromEntries(
                    Object.entries(pricing).map(([k, v]) => [k, Number(v || 0)]),
                  ) as unknown as Pricing,
                }).map((r) => (
                  <tr key={r.what} className="border-t border-gray-100">
                    <td className="py-2 text-gray-700">{r.what}</td>
                    <td className="py-2 text-gray-500">{r.cost}</td>
                    <td className={`py-2 font-semibold ${r.below ? 'text-red-600' : 'text-green-700'}`}>
                      {r.price}
                      {r.below ? ' · below cost' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-500 mt-3">
              Card cross-border spend (2.5% + $0.50), chargebacks ($45) and declines ($0.50) are
              charged by the card network and shown to users at cost.
            </p>
          </div>
        )}

        <h2 className="text-lg font-bold text-gray-900 pt-2">Minimums</h2>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
          <div>
            <label
              htmlFor="min-ngn"
              className="flex items-center gap-2 text-gray-700 font-semibold mb-2"
            >
              <ArrowDownToLine size={18} className="text-brand-600" />
              Smallest Naira withdrawal (₦)
            </label>
            <input
              id="min-ngn"
              type="number"
              min={0}
              step={100}
              value={withdrawalMinNgn}
              onChange={(e) => setWithdrawalMinNgn(e.target.value)}
              disabled={loading || saving}
              className={inputCls}
              placeholder="0"
            />
            <p className="text-sm text-gray-500 mt-2">
              Bank payouts below this are refused before any money moves. Each payout costs the
              same provider fee whatever its size. 0 means no floor.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <label
              htmlFor="min-usd"
              className="flex items-center gap-2 text-gray-700 font-semibold mb-2"
            >
              <ArrowDownToLine size={18} className="text-brand-600" />
              Smallest crypto withdrawal ($)
            </label>
            <input
              id="min-usd"
              type="number"
              min={0}
              step={1}
              value={withdrawalMinUsd}
              onChange={(e) => setWithdrawalMinUsd(e.target.value)}
              disabled={loading || saving}
              className={inputCls}
              placeholder="0"
            />
            <p className="text-sm text-gray-500 mt-2">
              Measured by the withdrawal&apos;s dollar value, priced off the coin&apos;s USDT price
              rather than the Naira rate above — so this floor does not move when that rate is
              changed. 0 means no floor.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <label
              htmlFor="min-deposit"
              className="flex items-center gap-2 text-gray-700 font-semibold mb-2"
            >
              <Banknote size={18} className="text-brand-600" />
              Advertised minimum deposit ($)
            </label>
            <input
              id="min-deposit"
              type="number"
              min={0}
              step={1}
              value={depositMinUsd}
              onChange={(e) => setDepositMinUsd(e.target.value)}
              disabled={loading || saving}
              className={inputCls}
              placeholder="0"
            />
            <p className="text-sm text-amber-700 mt-2">
              <span className="font-semibold">Shown to users, never enforced.</span> A deposit has
              already settled by the time we hear about it, so this can only set expectations
              before someone sends. Every deposit that arrives is still credited in full — refusing
              to credit one would mean keeping the user&apos;s money.
            </p>
          </div>
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
