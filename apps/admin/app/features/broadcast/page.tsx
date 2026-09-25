'use client';

import { useState } from 'react';
import { Bell, Send } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Audience = 'updates' | 'promos';

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

  const valid = title.trim().length >= 3 && body.trim().length >= 3 && (!url || /^\/(?!\/|\\)/.test(url));

  async function send() {
    if (!valid) return;
    if (!confirm(`Send "${title.trim()}" to every user who allows ${audience === 'updates' ? 'news' : 'promotions'}?`)) return;
    setSending(true);
    setResult(null);
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
      setResult({ kind: 'ok', text: `Sent to ${data.sent} device${data.sent === 1 ? '' : 's'}.` });
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
    </DashboardLayout>
  );
}
