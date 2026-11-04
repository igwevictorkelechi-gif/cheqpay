'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight, Film, List, PenSquare } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import { api, fmtWhen, PLATFORM_COLOR, PLATFORM_LABEL, STATUS_LABEL, STATUS_STYLE, type Post, type PostStatus } from '@/lib/social';

type Tab = 'upcoming' | 'approval' | 'drafts' | 'published' | 'failed' | 'all';

const TABS: { id: Tab; label: string; match: (s: PostStatus) => boolean }[] = [
  { id: 'upcoming', label: 'Upcoming', match: (s) => s === 'scheduled' || s === 'publishing' },
  { id: 'approval', label: 'Needs approval', match: (s) => s === 'pending_approval' },
  { id: 'drafts', label: 'Drafts', match: (s) => s === 'draft' },
  { id: 'published', label: 'Published', match: (s) => s === 'published' },
  { id: 'failed', label: 'Failed', match: (s) => s === 'failed' || s === 'partially_failed' },
  { id: 'all', label: 'All', match: () => true },
];

const when = (p: Post) => p.scheduledAt ?? p.createdAt;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export default function SocialPostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  useEffect(() => {
    // Wide window: two months back to a year ahead (the API's default).
    api<{ posts: Post[] }>('posts')
      .then((d) => setPosts(d.posts))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, posts.filter((p) => t.match(p.status)).length])), [posts]);
  const shown = useMemo(() => {
    const t = TABS.find((x) => x.id === tab)!;
    const list = posts.filter((p) => t.match(p.status));
    // Upcoming reads soonest first; everything else newest first.
    return tab === 'upcoming' ? [...list].sort((a, b) => when(a).localeCompare(when(b))) : list;
  }, [posts, tab]);

  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts) {
      const k = dayKey(new Date(when(p)));
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts]);

  const cells = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start Monday
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Social posts</h1>
          <p className="text-gray-600 mt-2">Draft, approve and schedule posts to the company&apos;s social accounts.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button onClick={() => setView('list')} className={`px-3 py-2 ${view === 'list' ? 'bg-gray-100' : ''}`} title="List"><List size={18} /></button>
            <button onClick={() => setView('calendar')} className={`px-3 py-2 ${view === 'calendar' ? 'bg-gray-100' : ''}`} title="Calendar"><CalendarDays size={18} /></button>
          </div>
          <Link href="/social/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700">
            <PenSquare size={16} /> New post
          </Link>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {view === 'list' ? (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium ${tab === t.id ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              >
                {t.label}
                {counts[t.id] > 0 && <span className={`ml-1.5 ${t.id === 'approval' || t.id === 'failed' ? 'text-amber-500 font-bold' : 'opacity-60'}`}>{counts[t.id]}</span>}
              </button>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-100">
            {loading && <p className="p-6 text-gray-500">Loading…</p>}
            {!loading && shown.length === 0 && <p className="p-6 text-gray-500">Nothing here.</p>}
            {shown.map((p) => (
              <Link key={p.id} href={`/social/posts/${p.id}`} className="flex items-start gap-4 p-4 hover:bg-gray-50">
                <Thumb post={p} />
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 line-clamp-2 break-words">{p.caption || <span className="text-gray-400">(no caption)</span>}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    <span>{p.status === 'draft' ? `Created ${fmtWhen(p.createdAt)}` : fmtWhen(p.scheduledAt ?? p.createdAt)}</span>
                    <span>· by {p.createdBy}</span>
                    {p.targets.map((t) => (
                      <span key={t.id} className="inline-flex items-center gap-1" title={`${PLATFORM_LABEL[t.platform]}: ${t.accountName}${t.error ? ` — ${t.error}` : ''}`}>
                        <span className="w-2 h-2 rounded-full" style={{ background: PLATFORM_COLOR[t.platform] }} />
                        <span className={t.status === 'failed' ? 'text-red-600' : ''}>{PLATFORM_LABEL[t.platform].split(' ')[0]}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="p-2 rounded hover:bg-gray-100"><ChevronLeft size={18} /></button>
            <div className="font-bold text-gray-900">{month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</div>
            <button onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="p-2 rounded hover:bg-gray-100"><ChevronRight size={18} /></button>
          </div>
          <div className="grid grid-cols-7 text-xs font-semibold text-gray-500 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-2 py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 border-t border-l border-gray-100">
            {cells.map((d) => {
              const inMonth = d.getMonth() === month.getMonth();
              const today = dayKey(d) === dayKey(new Date());
              const items = (byDay.get(dayKey(d)) ?? []).sort((a, b) => when(a).localeCompare(when(b)));
              return (
                <div key={d.toISOString()} className={`min-h-[110px] border-r border-b border-gray-100 p-1.5 ${inMonth ? '' : 'bg-gray-50'}`}>
                  <div className={`text-xs mb-1 ${today ? 'inline-grid place-items-center w-6 h-6 rounded-full bg-brand-600 text-white' : inMonth ? 'text-gray-700' : 'text-gray-400'}`}>{d.getDate()}</div>
                  <div className="space-y-1">
                    {items.slice(0, 4).map((p) => (
                      <Link key={p.id} href={`/social/posts/${p.id}`} className={`block truncate rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[p.status]}`} title={p.caption}>
                        {new Date(when(p)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} {p.caption || '(media)'}
                      </Link>
                    ))}
                    {items.length > 4 && <div className="text-[11px] text-gray-500 px-1">+{items.length - 4} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function Thumb({ post }: { post: Post }) {
  const m = post.media[0];
  return (
    <div className="w-14 h-14 rounded-lg bg-gray-100 grid place-items-center text-gray-400 shrink-0 text-xs">
      {m ? (m.kind === 'video' ? <Film size={20} /> : `${post.media.length} img`) : 'Text'}
    </div>
  );
}
