'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, PauseCircle, Ban, ShieldCheck } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type UserDetail = {
  user: {
    id: string;
    email: string;
    phone: string;
    status: string;
    kycTier: number;
    kycStatus: string;
    createdAt: string;
  };
  kyc: {
    legalName: string | null;
    dateOfBirth: string | null;
    email: string | null;
    phone: string | null;
    address: {
      street: string | null;
      city: string | null;
      state: string | null;
      postalCode: string | null;
    };
    bvnLast4: string | null;
    idDocType: string | null;
    idDocNumberLast4: string | null;
    mapleradCustomerId: string | null;
    mapleradTier: number;
    submittedAt: string | null;
    documents: { front: string | null; back: string | null };
  };
  activity: {
    lastSeenAt: string | null;
    lastIp: string | null;
    lastDevice: string | null;
    lastAction: string | null;
    lastTransactionIp: string | null;
    lastTransactionAt: string | null;
    devices: {
      id: string;
      ipAddress: string | null;
      device: string | null;
      platform: string;
      userAgent: string | null;
      hitCount: number;
      firstSeenAt: string;
      lastSeenAt: string;
    }[];
  };
  stats: {
    byType: { type: string; asset: string; count: number; total: string }[];
    lifecycle: {
      accountAgeDays: number;
      firstTransactionAt: string | null;
      lastTransactionAt: string | null;
      daysSinceLastActivity: number | null;
      totalTransactions: number;
      completedTransactions: number;
      failedTransactions: number;
    };
    risk: {
      deviceCount: number;
      distinctIpCount: number;
      failedRate: number;
      kycSubmissionCount: number;
      kycTier: number;
      providerEnrolled: boolean;
      depositAccountNumber: string | null;
    };
  };
  balances: { asset: string; available: string; locked: string }[];
  kycRecords: { id: string; tier: number; status: string; createdAt: string }[];
  transactions: {
    id: string;
    type: string;
    asset: string;
    amount: string;
    status: string;
    reference: string;
    ip: string | null;
    createdAt: string;
  }[];
};

/** Result of POST /api/maplerad/customers/{id}/sync. */
type MapleradSync = {
  customerId: string;
  snapshotId: string;
  tier: number;
  hasTier1Evidence: boolean;
  accountsFetched: number;
  linkedUserUpdated: boolean;
  customer: Record<string, unknown>;
  accounts: unknown[];
};

/** Result of POST /api/users/{id}/maplerad-enroll. */
type MapleradEnroll = {
  userId: string;
  phoneOutcome: string;
  enrolled: boolean;
  customerId?: string | null;
  tierBefore?: number;
  tier: number;
  kycTier?: number;
  kycTierGranted?: boolean;
  tier2Reason?: string | null;
  missing?: string[];
  account?: { accountNumber: string; bankName: string; accountName?: string } | null;
  accountError?: string | null;
  message: string;
};

/** A user's USD account as the admin endpoint reports it. */
type UsdAccountAdmin = {
  accountNumber: string;
  bankName: string;
  accountName?: string;
  currency: string;
  status?: string;
  consentRequired: boolean;
  consentUrl?: string | null;
};

/** GET /api/users/{id}/usd-account — stored account plus a live status poll. */
type UsdAccountState = {
  enrolled: boolean;
  customerId: string | null;
  account: UsdAccountAdmin | null;
  status: {
    status: string;
    messages: string[];
    currency: string;
    kycLink?: string | null;
  } | null;
};

/** POST /api/users/{id}/usd-account — the manual open. */
type UsdAccountOpened = {
  created: boolean;
  message: string;
  account: UsdAccountAdmin;
};

/** GET/POST /api/users/{id}/wallets — crypto addresses and mint outcomes. */
type WalletRow = { asset: string; network: string; address: string };
type MintOutcome = {
  asset: string;
  network: string;
  status: 'created' | 'existing' | 'skipped' | 'failed';
  address?: string;
  error?: string;
};
type WalletState = {
  enrolled: boolean;
  customerId: string | null;
  wallets: WalletRow[];
  mintable: { asset: string; network: string }[];
};
type MintResult = {
  wallets: WalletRow[];
  outcomes: MintOutcome[];
  blocked: string | null;
  message: string;
};

/** Anything not captured shows a dash rather than an empty cell. */
const DASH = '—';
function show(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return DASH;
  return String(v);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleString();
}

const ID_TYPE_LABELS: Record<string, string> = {
  NIN: 'NIN',
  PASSPORT: 'International passport',
  VOTERS_CARD: "Voter's card",
  DRIVERS_LICENSE: "Driver's licence",
};

/** One label/value pair in a definition grid. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  );
}

/** One number in the statistics grid. */
function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

const STATUSES = ['ACTIVE', 'SUSPENDED', 'BLOCKED'] as const;
const TIERS = [0, 1, 2, 3] as const;

function statusColor(status: string): string {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
    case 'COMPLETED':
    case 'APPROVED':
      return 'bg-green-100 text-green-800';
    case 'SUSPENDED':
    case 'PENDING':
    case 'PROCESSING':
      return 'bg-yellow-100 text-yellow-800';
    case 'BLOCKED':
    case 'FAILED':
    case 'REJECTED':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function formatAmount(asset: string, value: string): string {
  const n = Number(value);
  if (asset === 'NGN') {
    return `₦${(isFinite(n) ? n : 0).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `${value} ${asset}`;
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Live Maplerad sync: pull the customer + its accounts from the provider and
  // snapshot them. Lets an operator test the enrolment result from this page.
  const [syncing, setSyncing] = useState(false);
  const [sync, setSync] = useState<MapleradSync | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Repair path: supply the one missing field (the phone) and re-run the
  // enrolment from data already on file, rather than making the user resubmit
  // the whole KYC form from a newer client.
  const [enrollPhone, setEnrollPhone] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [enroll, setEnroll] = useState<MapleradEnroll | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // USD account: the dollar equivalent of the enrol/repair tool above. A user
  // can be stuck with no dollar account because the client form was never
  // finished, so an operator can supply the US-banking KYC and open it here.
  const [usd, setUsd] = useState<UsdAccountState | null>(null);
  const [usdChecking, setUsdChecking] = useState(false);
  const [usdOpening, setUsdOpening] = useState(false);
  const [usdOpened, setUsdOpened] = useState<UsdAccountOpened | null>(null);
  const [usdError, setUsdError] = useState<string | null>(null);
  // Crypto addresses: mint on demand and surface the provider's real error,
  // which is otherwise only visible in server logs.
  const [cw, setCw] = useState<WalletState | null>(null);
  const [cwLoading, setCwLoading] = useState(false);
  const [cwMinting, setCwMinting] = useState(false);
  const [cwResult, setCwResult] = useState<MintResult | null>(null);
  const [cwError, setCwError] = useState<string | null>(null);

  const [usdForm, setUsdForm] = useState({
    identificationNumber: '',
    employmentStatus: 'EMPLOYED',
    employmentDescription: '',
    nationality: 'NG',
    employerName: '',
    usResidencyStatus: 'NON_RESIDENT_ALIEN',
  });

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetch(`/api/users/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load user (${r.status})`);
        return r.json();
      })
      .then((d: UserDetail) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(
    async (payload: { status?: string; kycTier?: number }) => {
      if (!id) return;
      setSaving(true);
      setNotice(null);
      setError(null);
      try {
        const r = await fetch(`/api/users/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `Update failed (${r.status})`);
        setNotice('Changes saved.');
        load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [id, load],
  );

  const syncMaplerad = useCallback(async () => {
    const cid = data?.kyc.mapleradCustomerId;
    if (!cid) return;
    setSyncing(true);
    setSyncError(null);
    setSync(null);
    try {
      const r = await fetch(`/api/maplerad/customers/${cid}/sync`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `Sync failed (${r.status})`);
      setSync(d as MapleradSync);
      load(); // tier may have moved; refresh the page data.
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [data, load]);

  const runEnroll = useCallback(async () => {
    setEnrolling(true);
    setEnrollError(null);
    setEnroll(null);
    try {
      const r = await fetch(`/api/users/${id}/maplerad-enroll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone: enrollPhone.trim() || undefined,
          createAccount: true,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || d?.message || `Enrol failed (${r.status})`);
      setEnroll(d as MapleradEnroll);
      load(); // tier / account may have changed.
    } catch (e) {
      setEnrollError((e as Error).message);
    } finally {
      setEnrolling(false);
    }
  }, [id, enrollPhone, load]);

  /** Read where the USD account stands, including a live status poll. */
  const checkUsd = useCallback(async () => {
    setUsdChecking(true);
    setUsdError(null);
    try {
      const r = await fetch(`/api/users/${id}/usd-account`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || d?.message || `Check failed (${r.status})`);
      setUsd(d as UsdAccountState);
    } catch (e) {
      setUsdError((e as Error).message);
    } finally {
      setUsdChecking(false);
    }
  }, [id]);

  /** Open the USD account on the user's behalf from the supplied KYC. */
  const openUsd = useCallback(async () => {
    setUsdOpening(true);
    setUsdError(null);
    setUsdOpened(null);
    try {
      const r = await fetch(`/api/users/${id}/usd-account`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(usdForm),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || d?.message || `Open failed (${r.status})`);
      setUsdOpened(d as UsdAccountOpened);
      await checkUsd();
    } catch (e) {
      setUsdError((e as Error).message);
    } finally {
      setUsdOpening(false);
    }
  }, [id, usdForm, checkUsd]);

  /** Read the user's crypto addresses and what is still mintable. */
  const loadWallets = useCallback(async () => {
    setCwLoading(true);
    setCwError(null);
    try {
      const r = await fetch(`/api/users/${id}/wallets`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || d?.message || `Load failed (${r.status})`);
      setCw(d as WalletState);
    } catch (e) {
      setCwError((e as Error).message);
    } finally {
      setCwLoading(false);
    }
  }, [id]);

  /** Mint addresses. No pair = the launch set; a pair mints just that one. */
  const mintWallets = useCallback(
    async (pair?: { asset: string; network: string; offramp?: boolean }) => {
      setCwMinting(true);
      setCwError(null);
      setCwResult(null);
      try {
        const r = await fetch(`/api/users/${id}/wallets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(pair ?? {}),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || d?.message || `Generate failed (${r.status})`);
        setCwResult(d as MintResult);
        await loadWallets();
      } catch (e) {
        setCwError((e as Error).message);
      } finally {
        setCwMinting(false);
      }
    },
    [id, loadWallets],
  );

  const usdFormValid =
    usdForm.identificationNumber.trim().length >= 3 &&
    usdForm.employmentDescription.trim().length >= 2 &&
    usdForm.employerName.trim().length >= 1;

  const u = data?.user;

  return (
    <DashboardLayout>
      <div className="mb-6">
        <a
          href="/users"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Back to users
        </a>
      </div>

      {loading && <p className="text-gray-500">Loading…</p>}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && u && (
        <>
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{u.email}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {u.phone} · ID {u.id.slice(0, 8)} · Joined{' '}
                {new Date(u.createdAt).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-medium ${statusColor(
                u.status,
              )}`}
            >
              {u.status}
            </span>
          </div>

          {notice && (
            <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
              {notice}
            </div>
          )}

          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Account status</h2>
            <div className="flex flex-wrap gap-3">
              {STATUSES.map((s) => {
                const active = u.status.toUpperCase() === s;
                const Icon =
                  s === 'ACTIVE' ? CheckCircle2 : s === 'SUSPENDED' ? PauseCircle : Ban;
                return (
                  <button
                    key={s}
                    disabled={active || saving}
                    onClick={() => patch({ status: s })}
                    className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                      active
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50'
                    }`}
                  >
                    <Icon size={16} />
                    {active ? `${s} (current)` : s}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck size={18} className="text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">KYC tier</h2>
              <span
                className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(
                  u.kycStatus,
                )}`}
              >
                {u.kycStatus}
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {TIERS.map((t) => {
                const active = u.kycTier === t;
                return (
                  <button
                    key={t}
                    disabled={active || saving}
                    onClick={() => patch({ kycTier: t })}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                      active
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50'
                    }`}
                  >
                    Tier {t}
                  </button>
                );
              })}
            </div>
          </section>

          {/* What the user actually submitted at KYC. Numbers are last-4 only;
              the whole BVN lives behind the audited compliance lookup. */}
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-gray-900">KYC submission</h2>
              <span className="text-sm text-gray-500">
                {data.kyc.submittedAt
                  ? `Submitted ${formatDateTime(data.kyc.submittedAt)}`
                  : 'Not submitted'}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Legal name" value={show(data.kyc.legalName)} />
              <Field label="Date of birth" value={show(data.kyc.dateOfBirth)} />
              <Field label="Email" value={show(data.kyc.email)} />
              <Field label="Phone" value={show(data.kyc.phone)} />
              <Field
                label="BVN"
                value={data.kyc.bvnLast4 ? `•••• ${data.kyc.bvnLast4}` : DASH}
              />
              <Field
                label="ID document"
                value={
                  data.kyc.idDocType
                    ? `${ID_TYPE_LABELS[data.kyc.idDocType] ?? data.kyc.idDocType}${
                        data.kyc.idDocNumberLast4 ? ` · •••• ${data.kyc.idDocNumberLast4}` : ''
                      }`
                    : DASH
                }
              />
              <Field
                label="Address"
                value={
                  data.kyc.address.street
                    ? [
                        data.kyc.address.street,
                        data.kyc.address.city,
                        data.kyc.address.state,
                        data.kyc.address.postalCode,
                      ]
                        .filter(Boolean)
                        .join(', ')
                    : DASH
                }
              />
              <Field
                label="Provider customer"
                value={
                  data.kyc.mapleradCustomerId
                    ? `${data.kyc.mapleradCustomerId} (tier ${data.kyc.mapleradTier})`
                    : 'Not enrolled'
                }
              />
            </dl>

            <div className="mt-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                ID document images
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(['front', 'back'] as const).map((side) => {
                  const url = data.kyc.documents[side];
                  return (
                    <div key={side}>
                      <p className="mb-1 text-sm font-medium capitalize text-gray-700">{side}</p>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {/* Signed URL, short-lived. eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`${side} of the ID document`}
                            className="h-48 w-full rounded-lg border border-gray-200 object-contain bg-gray-50"
                          />
                        </a>
                      ) : (
                        <div className="flex h-48 w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
                          Not uploaded
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Live provider sync — pull the Maplerad customer + accounts on demand. */}
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Provider (Maplerad)</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {data.kyc.mapleradCustomerId
                    ? `Fetch GET /customers/${data.kyc.mapleradCustomerId} and its accounts, store a snapshot, and reconcile the tier.`
                    : 'This user has no Maplerad customer yet — nothing to sync until they enrol.'}
                </p>
              </div>
              <button
                onClick={syncMaplerad}
                disabled={!data.kyc.mapleradCustomerId || syncing}
                className="inline-flex items-center gap-2 rounded-lg border border-brand-500 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : 'Sync from Maplerad'}
              </button>
            </div>

            {syncError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {syncError}
              </div>
            )}

            {sync && (
              <>
                <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Field label="Tier" value={sync.tier} />
                  <Field label="Tier-1 evidence" value={sync.hasTier1Evidence ? 'Yes' : 'No'} />
                  <Field label="Accounts" value={sync.accountsFetched} />
                  <Field label="User updated" value={sync.linkedUserUpdated ? 'Yes' : 'No'} />
                </dl>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Customer (ID number &amp; image redacted)
                </p>
                <pre className="mb-4 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                  {JSON.stringify(sync.customer, null, 2)}
                </pre>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Accounts
                </p>
                <pre className="max-h-72 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                  {JSON.stringify(sync.accounts, null, 2)}
                </pre>
              </>
            )}

            {/* Repair: supply the one missing field and re-run the enrolment
                from data already on file. An account with a complete BVN, date
                of birth, ID and address can sit stuck at tier 0 purely because
                the phone never arrived, and tier 0 gets no NGN account. */}
            <div className="mt-6 border-t border-gray-200 pt-6">
              <h3 className="text-sm font-semibold text-gray-900">Enrol / upgrade tier</h3>
              <p className="mt-1 text-sm text-gray-500">
                Re-runs the enrolment using the BVN, date of birth and address already stored,
                then attempts tier 2 with the government ID on file. Supply a phone number if
                one is missing — that is usually the only thing blocking tier 1.
                <br />
                <strong>Tier 1</strong> issues the NGN account. <strong>Tier 2</strong> raises
                limits (₦50k → ₦1m per transaction) and unlocks crypto withdrawals.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  +234
                </span>
                <input
                  value={enrollPhone}
                  onChange={(e) => setEnrollPhone(e.target.value)}
                  inputMode="tel"
                  placeholder="801 234 5678"
                  className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500"
                />
                <button
                  onClick={runEnroll}
                  disabled={enrolling}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enrolling ? 'Working…' : 'Enrol / upgrade tier'}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                Leave the number blank to retry with whatever is already on file.
              </p>

              {enrollError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {enrollError}
                </div>
              )}

              {enroll && (
                <div
                  className={`mt-3 rounded-lg border p-4 text-sm ${
                    enroll.tier >= 1
                      ? 'border-green-200 bg-green-50 text-green-800'
                      : 'border-yellow-200 bg-yellow-50 text-yellow-800'
                  }`}
                >
                  <p className="font-medium">{enroll.message}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field label="Phone" value={enroll.phoneOutcome} />
                    <Field
                      label="Tier"
                      value={
                        enroll.tierBefore !== undefined && enroll.tierBefore !== enroll.tier
                          ? `${enroll.tierBefore} → ${enroll.tier}`
                          : enroll.tier
                      }
                    />
                    <Field
                      label="KYC tier (limits)"
                      value={
                        enroll.kycTier === undefined
                          ? DASH
                          : enroll.kycTierGranted
                            ? `${enroll.kycTier} (granted now)`
                            : enroll.kycTier
                      }
                    />
                    <Field label="Customer" value={show(enroll.customerId)} />
                    <Field
                      label="Deposit account"
                      value={
                        enroll.account
                          ? `${enroll.account.accountNumber} · ${enroll.account.bankName}`
                          : enroll.accountError
                            ? `Failed: ${enroll.accountError}`
                            : DASH
                      }
                    />
                  </dl>
                  {enroll.tier2Reason && enroll.tier < 2 && (
                    <p className="mt-3">
                      Tier 2 not granted: <strong>{enroll.tier2Reason}</strong>
                    </p>
                  )}
                  {enroll.missing && enroll.missing.length > 0 && (
                    <p className="mt-3">
                      Still missing: <strong>{enroll.missing.join(', ')}</strong>
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* USD account: the dollar equivalent of the repair tool above. */}
            <div className="mt-6 border-t border-gray-200 pt-6">
              <h3 className="text-sm font-semibold text-gray-900">USD account</h3>
              <p className="mt-1 text-sm text-gray-500">
                A dollar account needs US-banking KYC the Naira one never asks for, so a user can
                sit with no USD account simply because they never finished that form. Check where
                it stands, or open it on their behalf. Requires an enrolled Maplerad customer —
                run <strong>Enrol / upgrade tier</strong> first if there is none.
              </p>

              <button
                onClick={checkUsd}
                disabled={usdChecking}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {usdChecking ? 'Checking…' : 'Check USD account status'}
              </button>

              {usd && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field label="Enrolled" value={usd.enrolled ? 'Yes' : 'No'} />
                    <Field
                      label="Account"
                      value={
                        usd.account
                          ? `${usd.account.accountNumber} · ${usd.account.bankName}`
                          : 'Not opened'
                      }
                    />
                    <Field label="Request status" value={show(usd.status?.status)} />
                    <Field
                      label="Consent"
                      value={usd.account?.consentRequired ? 'Required' : 'Not required'}
                    />
                  </dl>
                  {usd.status?.messages && usd.status.messages.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-gray-700">
                      {usd.status.messages.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  )}
                  {usd.status?.kycLink && (
                    <p className="mt-3">
                      <a
                        href={usd.status.kycLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-brand-600 underline"
                      >
                        Open the provider’s verification link
                      </a>
                    </p>
                  )}
                </div>
              )}

              {/* Manual open — only offered when there is no account yet. */}
              {usd && !usd.account && (
                <div className="mt-4 rounded-lg border border-gray-200 p-4">
                  <p className="text-sm font-medium text-gray-900">Open it manually</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1 block text-gray-600">Tax / ID number</span>
                      <input
                        value={usdForm.identificationNumber}
                        onChange={(e) =>
                          setUsdForm((f) => ({ ...f, identificationNumber: e.target.value }))
                        }
                        placeholder="Tax identification number"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-gray-600">Employment status</span>
                      <select
                        value={usdForm.employmentStatus}
                        onChange={(e) =>
                          setUsdForm((f) => ({ ...f, employmentStatus: e.target.value }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500"
                      >
                        {['EMPLOYED', 'SELF_EMPLOYED', 'STUDENT', 'UNEMPLOYED', 'RETIRED'].map(
                          (v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-gray-600">What do they do?</span>
                      <input
                        value={usdForm.employmentDescription}
                        onChange={(e) =>
                          setUsdForm((f) => ({ ...f, employmentDescription: e.target.value }))
                        }
                        placeholder="e.g. Software engineering"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-gray-600">Employer / business</span>
                      <input
                        value={usdForm.employerName}
                        onChange={(e) => setUsdForm((f) => ({ ...f, employerName: e.target.value }))}
                        placeholder="e.g. Self / company name"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-gray-600">Nationality (ISO-2)</span>
                      <input
                        value={usdForm.nationality}
                        onChange={(e) =>
                          setUsdForm((f) => ({
                            ...f,
                            nationality: e.target.value.toUpperCase().slice(0, 2),
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-gray-600">US residency</span>
                      <select
                        value={usdForm.usResidencyStatus}
                        onChange={(e) =>
                          setUsdForm((f) => ({ ...f, usResidencyStatus: e.target.value }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500"
                      >
                        {['NON_RESIDENT_ALIEN', 'RESIDENT_ALIEN', 'US_CITIZEN'].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    onClick={openUsd}
                    disabled={usdOpening || !usdFormValid || !usd.enrolled}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {usdOpening ? 'Opening…' : 'Open USD account'}
                  </button>
                  {!usd.enrolled && (
                    <p className="mt-2 text-xs text-gray-500">
                      Enrol the customer with Maplerad first — the USD account hangs off the
                      customer id.
                    </p>
                  )}
                </div>
              )}

              {usdError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {usdError}
                </div>
              )}

              {usdOpened && (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                  <p className="font-medium">{usdOpened.message}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field label="Account" value={usdOpened.account.accountNumber} />
                    <Field label="Bank" value={usdOpened.account.bankName} />
                    <Field label="Status" value={show(usdOpened.account.status)} />
                  </dl>
                </div>
              )}
            </div>

            {/* Crypto deposit addresses. Each is minted for this user alone —
                that is what lets an incoming deposit be credited automatically,
                since the webhook identifies the owner by the address. */}
            <div className="mt-6 border-t border-gray-200 pt-6">
              <h3 className="text-sm font-semibold text-gray-900">Crypto deposit addresses</h3>
              <p className="mt-1 text-sm text-gray-500">
                Unique per user — the deposit webhook credits by matching the address to its
                holder, so a shared address could not be attributed to anyone. Addresses are
                pre-generated at enrolment; generate here if a user has none, or to add a chain.
                Requires an enrolled Maplerad customer.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={loadWallets}
                  disabled={cwLoading}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cwLoading ? 'Loading…' : 'Show crypto addresses'}
                </button>
                <button
                  onClick={() => mintWallets()}
                  disabled={cwMinting}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cwMinting ? 'Generating…' : 'Generate addresses'}
                </button>
              </div>

              {cw && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                  <Field label="Enrolled" value={cw.enrolled ? 'Yes' : 'No'} />
                  {cw.wallets.length === 0 ? (
                    <p className="mt-3 text-gray-700">
                      This user has no crypto addresses yet.
                    </p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b border-gray-200 text-left text-gray-500">
                          <tr>
                            <th className="py-2 pr-4 font-medium">Asset</th>
                            <th className="py-2 pr-4 font-medium">Network</th>
                            <th className="py-2 font-medium">Address</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cw.wallets.map((w) => (
                            <tr key={`${w.asset}/${w.network}`} className="border-b border-gray-100">
                              <td className="py-2 pr-4 font-medium text-gray-900">{w.asset}</td>
                              <td className="py-2 pr-4 text-gray-700">{w.network}</td>
                              <td className="py-2 break-all font-mono text-xs text-gray-700">
                                {w.address}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {cw.mintable.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Not yet generated
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {cw.mintable.map((m) => (
                          <button
                            key={`${m.asset}/${m.network}`}
                            onClick={() =>
                              mintWallets({
                                asset: m.asset,
                                network: m.network,
                                // Only Solana can be withdrawn from, so any other
                                // chain has to offramp to USD to be safe.
                                offramp: m.network !== 'SOLANA',
                              })
                            }
                            disabled={cwMinting}
                            className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white disabled:opacity-50"
                          >
                            + {m.asset} on {m.network}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {cwError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {cwError}
                </div>
              )}

              {cwResult && (
                <div
                  className={`mt-3 rounded-lg border p-4 text-sm ${
                    cwResult.blocked
                      ? 'border-yellow-200 bg-yellow-50 text-yellow-800'
                      : 'border-green-200 bg-green-50 text-green-800'
                  }`}
                >
                  <p className="font-medium">{cwResult.message}</p>
                  {cwResult.outcomes.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {cwResult.outcomes.map((o, i) => (
                        <li key={i}>
                          <strong>
                            {o.asset}/{o.network}
                          </strong>
                          : {o.status}
                          {/* The provider's own message — the thing that explains
                              why nothing was minted. */}
                          {o.error ? ` — ${o.error}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Where this account connects from. */}
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Devices &amp; IP addresses</h2>

            <dl className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Last login" value={formatDateTime(data.activity.lastSeenAt)} />
              <Field label="Last IP" value={show(data.activity.lastIp)} />
              <Field label="Last device" value={show(data.activity.lastDevice)} />
              <Field label="Last action" value={show(data.activity.lastAction)} />
              <Field
                label="Last transaction IP"
                value={
                  data.activity.lastTransactionIp ?? (
                    <span className="text-gray-500">
                      {DASH}{' '}
                      <span className="text-xs">(not recorded before this release)</span>
                    </span>
                  )
                }
              />
              <Field
                label="Last transaction at"
                value={formatDateTime(data.activity.lastTransactionAt)}
              />
            </dl>

            {data.activity.devices.length === 0 ? (
              <p className="text-gray-500">No device activity recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 text-left text-gray-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">IP address</th>
                      <th className="py-2 pr-4 font-medium">Device</th>
                      <th className="py-2 pr-4 font-medium">Platform</th>
                      <th className="py-2 pr-4 font-medium">Seen</th>
                      <th className="py-2 pr-4 font-medium">First seen</th>
                      <th className="py-2 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.activity.devices.map((d) => (
                      <tr key={d.id}>
                        <td className="py-2 pr-4 font-mono text-gray-900">{show(d.ipAddress)}</td>
                        <td className="py-2 pr-4 text-gray-900">{show(d.device)}</td>
                        <td className="py-2 pr-4 text-gray-600">{d.platform}</td>
                        <td className="py-2 pr-4 text-gray-600">{d.hitCount}×</td>
                        <td className="py-2 pr-4 text-gray-600">{formatDateTime(d.firstSeenAt)}</td>
                        <td className="py-2 text-gray-600">{formatDateTime(d.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Statistics. */}
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Statistics</h2>

            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Activity &amp; lifecycle
            </p>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Account age" value={`${data.stats.lifecycle.accountAgeDays}d`} />
              <Stat label="Transactions" value={data.stats.lifecycle.totalTransactions} />
              <Stat label="Completed" value={data.stats.lifecycle.completedTransactions} />
              <Stat label="Failed" value={data.stats.lifecycle.failedTransactions} />
              <Stat
                label="First transaction"
                value={
                  data.stats.lifecycle.firstTransactionAt
                    ? new Date(data.stats.lifecycle.firstTransactionAt).toLocaleDateString()
                    : DASH
                }
              />
              <Stat
                label="Last transaction"
                value={
                  data.stats.lifecycle.lastTransactionAt
                    ? new Date(data.stats.lifecycle.lastTransactionAt).toLocaleDateString()
                    : DASH
                }
              />
              <Stat
                label="Days since active"
                value={data.stats.lifecycle.daysSinceLastActivity ?? DASH}
              />
            </div>

            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Risk &amp; compliance
            </p>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Devices" value={data.stats.risk.deviceCount} />
              <Stat label="Distinct IPs" value={data.stats.risk.distinctIpCount} />
              <Stat
                label="Failed rate"
                value={`${data.stats.risk.failedRate}%`}
                hint="of all transactions"
              />
              <Stat label="KYC submissions" value={data.stats.risk.kycSubmissionCount} />
              <Stat label="KYC tier" value={data.stats.risk.kycTier} />
              <Stat
                label="Provider enrolled"
                value={data.stats.risk.providerEnrolled ? 'Yes' : 'No'}
              />
              <Stat
                label="Deposit account"
                value={data.stats.risk.depositAccountNumber ?? 'None'}
              />
            </div>

            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Lifetime totals by type
            </p>
            {data.stats.byType.length === 0 ? (
              <p className="text-gray-500">No transactions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 text-left text-gray-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Type</th>
                      <th className="py-2 pr-4 font-medium">Asset</th>
                      <th className="py-2 pr-4 font-medium">Count</th>
                      <th className="py-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.stats.byType.map((g) => (
                      <tr key={`${g.type}-${g.asset}`}>
                        <td className="py-2 pr-4 font-medium text-gray-900">{g.type}</td>
                        <td className="py-2 pr-4 text-gray-600">{g.asset}</td>
                        <td className="py-2 pr-4 text-gray-600">{g.count}</td>
                        <td className="py-2 font-semibold text-gray-900">
                          {formatAmount(g.asset, g.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Balances</h2>
            {data.balances.length === 0 ? (
              <p className="text-sm text-gray-500">No balances.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                {data.balances.map((b) => (
                  <div key={b.asset} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      {b.asset}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-gray-900">
                      {formatAmount(b.asset, b.available)}
                    </p>
                    <p className="text-xs text-gray-500">Locked: {formatAmount(b.asset, b.locked)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900">Recent transactions</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Reference</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">IP</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.transactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                        No transactions.
                      </td>
                    </tr>
                  )}
                  {data.transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{t.type}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {formatAmount(t.asset, t.amount)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(
                            t.status,
                          )}`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{t.reference}</td>
                      <td className="px-6 py-4 font-mono text-sm text-gray-500">{show(t.ip)}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </DashboardLayout>
  );
}
