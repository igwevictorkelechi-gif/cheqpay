'use client';

import { useEffect, useState } from 'react';
import { Bell, ExternalLink, History, RefreshCw, Send } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Audience = 'updates' | 'promos';

interface SentBroadcast {
  id: string;
  sentAt: string;
  sentBy: string | null;
  title: string;
  body: string;
  category: string;
  url: string | null;
  devices: number | null;
  browsers: number | null;
  apps: number | null;
  shown: number | null;
  tapped: number | null;
}

/**
 * Send a push notification to every user who allows it — on their phones and
 * in their browsers. Guarded server-side by a fresh authenticator code (asked
 * for automatically when you press Send) and at most one send a minute.
 */
export default function BroadcastPage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [audience, setAudience] = useState<Audience>('updates');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [stats, setStats] = useState<{ accepted: number; delivered: number; opened: number } | null>(null);
  const [history, setHistory] = useState<SentBroadcast[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function loadHistory() {
    setHistoryError(null);
    try {
      const res = await fetch('/api/broadcast', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setHistory(data.broadcasts);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Failed to load');
    }
  }
  useEffect(() => {
    void loadHistory();
  }, []);
  // Refresh the list as phones report back after a send.
  useEffect(() => {
    if (stats) void loadHistory();
  }, [stats?.delivered, stats?.opened]); // eslint-disable-line react-hooks/exhaustive-deps

  function reuse(b: SentBroadcast) {
    setTitle(b.title);
    setBody(b.body);
    setUrl(b.url ?? '');
    setAudience(b.category === 'promos' ? 'promos' : 'updates');
    setResult(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // After a send, watch phones report back for a couple of minutes. "Accepted"
  // is Apple/Google taking it; "shown" is the phone actually displaying it.
  useEffect(() => {
    if (!sentId) return;
    let stop = false;
    let n = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/broadcast/${sentId}`, { cache: 'no-store' });
        if (res.ok && !stop) setStats(await res.json());
      } catch {
        /* keep the last numbers */
      }
      if (!stop && ++n < 40) timer = setTimeout(tick, n < 10 ? 3000 : 6000);
    };
    let timer = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [sentId]);

  const valid = title.trim().length >= 3 && body.trim().length >= 3 && (!url || /^\/(?!\/|\\)/.test(url));

  async function send() {
    if (!valid) return;
    if (!confirm(`Send "${title.trim()}" to every user who allows ${audience === 'updates' ? 'news' : 'promotions'}?`)) return;
    setSending(true);
    setResult(null);
    setSentId(null);
    setStats(null);
    try {
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          category: audience,
          ...(url.trim() ? { url: url.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to send');
      setResult({
        kind: 'ok',
        text: `Accepted for ${data.sent} device${data.sent === 1 ? '' : 's'} by Apple/Google. Waiting for phones to confirm they showed it…`,
      });
      if (data.id) setSentId(data.id);
      void loadHistory();
      setTitle('');
      setBody('');
      setUrl('');
    } catch (e) {
      setResult({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to send' });
    } finally {
      setSending(false);
    }
  }

  const inputCls =
    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Broadcast notification</h1>
        <p className="text-gray-600 mt-2">
          Reaches the phones and browsers of every user who allows it. Users who turned the
          category off never receive it.
        </p>
      </div>

      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700">Audience</label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as Audience)}
              className={inputCls}
            >
              <option value="updates">News &amp; announcements (on by default)</option>
              <option value="promos">Promotions (only users who opted in)</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700">
              Title <span className="font-normal text-gray-400">({title.length}/60)</span>
            </label>
            <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700">
              Message <span className="font-normal text-gray-400">({body.length}/180)</span>
            </label>
            <textarea
              value={body}
              maxLength={180}
              rows={3}
              onChange={(e) => setBody(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700">
              Opens (optional)
            </label>
            <input
              value={url}
              placeholder="/pricing"
              onChange={(e) => setUrl(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-gray-500">A page on the site, starting with “/”.</p>
          </div>
          {result && (
            <p className={`text-sm ${result.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{result.text}</p>
          )}
          {stats && (
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-center text-sm">
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.accepted}</p>
                <p className="text-gray-600">Accepted</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-700">{stats.delivered}</p>
                <p className="text-gray-600">Shown on phone</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-brand-600">{stats.opened}</p>
                <p className="text-gray-600">Tapped</p>
              </div>
              <p className="col-span-3 mt-1 text-xs text-gray-500">
                Phones still on the old app version don&apos;t report back until they open CheqPay once.
              </p>
            </div>
          )}
          <button
            onClick={send}
            disabled={!valid || sending}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Send size={18} />
            {sending ? 'Sending…' : 'Send notification'}
          </button>
        </div>

        {/* Preview */}
        <div>
          <p className="mb-2 text-sm font-semibold text-gray-700">Preview</p>
          <div className="flex gap-3 rounded-2xl bg-gray-900 p-4 text-white shadow-lg">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600">
              <Bell size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{title || 'Title'}</p>
              <p className="mt-0.5 text-sm text-gray-300">{body || 'Your message appears here.'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 max-w-4xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <History size={20} /> Sent notifications
          </h2>
          <button onClick={() => void loadHistory()} className="flex items-center gap-1.5 text-sm font-semibold text-brand-600">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        {historyError ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{historyError}</p>
        ) : history === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : history.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
            Nothing sent yet.
          </p>
        ) : (
          <div className="space-y-3">
            {history.map((b) => (
              <div key={b.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900">{b.title}</p>
                    <p className="mt-0.5 text-sm text-gray-700">{b.body}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span>{new Date(b.sentAt).toLocaleString()}</span>
                      {b.sentBy && <span>by {b.sentBy}</span>}
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
                        {b.category === 'promos' ? 'Promotions' : 'News'}
                      </span>
                      {b.url && (
                        <span className="inline-flex items-center gap-1">
                          <ExternalLink size={12} /> {b.url}
                        </span>
                      )}
                    </p>
                  </div>
                  <button onClick={() => reuse(b)} className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                    Use again
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-lg font-bold text-gray-900">{b.devices ?? '—'}</p>
                    <p className="text-gray-600">Devices</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-lg font-bold text-gray-900">
                      {b.apps ?? '—'} <span className="font-normal text-gray-400">/</span> {b.browsers ?? '—'}
                    </p>
                    <p className="text-gray-600">Phone app / browsers</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-lg font-bold text-green-700">{b.shown ?? '—'}</p>
                    <p className="text-gray-600">Shown</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-lg font-bold text-brand-600">{b.tapped ?? '—'}</p>
                    <p className="text-gray-600">Tapped</p>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-500">
              “Shown” and “Tapped” are reported by browsers and the installed web app; “—” means that send
              happened before this was tracked.
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
