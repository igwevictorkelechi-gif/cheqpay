'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Link2, Loader2, Trash2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import { api, PLATFORM_COLOR, PLATFORM_LABEL, type Account, type ProviderInfo } from '@/lib/social';

interface Setup {
  providers: ProviderInfo[];
  storageConfigured: boolean;
  publicUrlConfigured: boolean;
  tiktokPublic: boolean;
  mediaProxyBase: string | null;
}

const KEYS: Record<ProviderInfo['id'], string> = {
  meta: 'META_APP_ID and META_APP_SECRET',
  x: 'X_CLIENT_ID and X_CLIENT_SECRET',
  tiktok: 'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET',
  linkedin: 'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET',
};

const NOTES: Record<ProviderInfo['id'], string> = {
  meta: 'One login connects your Facebook Pages and the Instagram business accounts linked to them. Meta must approve the app (App Review) for posting.',
  x: 'Posting needs an X developer plan that allows writes.',
  tiktok: 'Until TikTok audits the app, posts go up as private (“only me”). Photo posts also need the media URL prefix below verified in the TikTok developer portal.',
  linkedin: 'Connects the company Pages you administer. LinkedIn must approve the app for its Community Management API.',
};

function expiry(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86400_000);
  if (days < 0) return 'login expired';
  if (days <= 1) return 'login refreshes automatically';
  return `login valid for ${days} days`;
}

export default function SocialAccountsPage() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api<Setup>('setup'), api<{ accounts: Account[] }>('accounts')]);
      setSetup(s);
      setAccounts(a.accounts);
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    // The platform login sends people back here with ?connected=… or ?error=….
    const q = new URLSearchParams(window.location.search);
    if (q.get('connected')) setMessage({ kind: 'ok', text: `Connected ${q.get('count') ?? ''} account(s).` });
    if (q.get('error')) setMessage({ kind: 'err', text: q.get('error') ?? 'Connecting failed.' });
    if (q.toString()) window.history.replaceState(null, '', '/social/accounts');
    void load();
  }, [load]);

  async function connect(id: ProviderInfo['id']) {
    setBusy(id);
    setMessage(null);
    try {
      const { url } = await api<{ url: string }>(`connect/${id}`, { method: 'POST' });
      window.location.href = url;
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message });
      setBusy(null);
    }
  }

  async function disconnect(a: Account) {
    if (!confirm(`Disconnect ${a.name}? Posts waiting to go to it will be cancelled.`)) return;
    setBusy(a.id);
    try {
      await api(`accounts/${a.id}`, { method: 'DELETE' });
      setAccounts((xs) => xs.filter((x) => x.id !== a.id));
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Social accounts</h1>
        <p className="text-gray-600 mt-2">Connect the company&apos;s accounts once; anyone with access to Social can then schedule posts to them.</p>
      </div>

      {message && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {setup && (!setup.storageConfigured || !setup.publicUrlConfigured) && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>
            {!setup.publicUrlConfigured && 'API_PUBLIC_URL is not set on the API, so platform logins have nowhere to return to. '}
            {!setup.storageConfigured && 'Media storage (Supabase service key) is not configured, so images and videos cannot be uploaded.'}
          </span>
        </div>
      )}

      <h2 className="text-lg font-bold text-gray-900 mb-3">Connected</h2>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-10">
        {accounts.length === 0 && <p className="p-6 text-gray-500">No accounts yet. Connect one below.</p>}
        {accounts.map((a, i) => (
          <div key={a.id} className={`flex items-center gap-4 p-4 ${i ? 'border-t border-gray-100' : ''}`}>
            {a.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover bg-gray-100" />
            ) : (
              <div className="w-11 h-11 rounded-full grid place-items-center text-white font-bold" style={{ background: PLATFORM_COLOR[a.platform] }}>
                {a.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-900 truncate">
                {a.name} {a.username && <span className="text-gray-500 font-normal">@{a.username}</span>}
              </div>
              <div className="text-sm text-gray-500">
                <span style={{ color: PLATFORM_COLOR[a.platform] }} className="font-medium">{PLATFORM_LABEL[a.platform]}</span>
                {' · connected by '}{a.connectedBy}
                {expiry(a.tokenExpiresAt) && ` · ${expiry(a.tokenExpiresAt)}`}
              </div>
              {a.status === 'needs_reconnect' && (
                <div className="text-sm text-red-700 mt-1 flex items-start gap-1">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Needs reconnecting{a.lastError ? `: ${a.lastError}` : ''}
                </div>
              )}
            </div>
            {a.status === 'active' ? (
              <span className="hidden sm:inline-flex items-center gap-1 text-sm text-green-700"><CheckCircle2 size={16} /> Active</span>
            ) : null}
            <button
              onClick={() => disconnect(a)}
              disabled={busy === a.id}
              className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              title="Disconnect"
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold text-gray-900 mb-3">Connect a platform</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {setup?.providers.map((p) => (
          <div key={p.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-bold text-gray-900">{p.label}</div>
              <button
                onClick={() => connect(p.id)}
                disabled={!p.configured || busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-40"
              >
                {busy === p.id ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                {accounts.some((a) => p.platforms.includes(a.platform)) ? 'Connect another' : 'Connect'}
              </button>
            </div>
            <p className="text-sm text-gray-600">{NOTES[p.id]}</p>
            {p.id === 'tiktok' && setup.tiktokPublic && <p className="text-sm text-green-700">TikTok audit confirmed: posts go up publicly.</p>}
            {!p.configured && (
              <div className="text-sm rounded-lg bg-gray-50 border border-gray-200 p-3 text-gray-700 space-y-2">
                <p><b>Not set up yet.</b> Set {KEYS[p.id]} on the API project, and register this callback URL in the platform&apos;s developer console:</p>
                {p.callbackUrl ? <CopyLine text={p.callbackUrl} /> : <p className="text-amber-700">Set API_PUBLIC_URL first.</p>}
              </div>
            )}
            {p.id === 'tiktok' && setup.mediaProxyBase && (
              <div className="text-xs text-gray-500">
                Media URL prefix to verify with TikTok: <CopyLine text={setup.mediaProxyBase} />
              </div>
            )}
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 truncate rounded bg-white border border-gray-200 px-2 py-1 font-mono text-xs">{text}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
        title="Copy"
      >
        {copied ? <CheckCircle2 size={14} className="text-green-600" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
