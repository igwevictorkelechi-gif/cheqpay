'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Loader2, CalendarDays, Ticket } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Tier { id: string; name: string; priceFormatted: string; sold: number; capacity: number | null; active: boolean }
interface Event {
  id: string;
  title: string;
  venue: string;
  city: string;
  startsAt: string | null;
  active: boolean;
  tiers: Tier[];
  soldCount: number;
  revenueFormatted: string;
}

interface Draft {
  title: string; venue: string; city: string; startsAt: string; imageUrl: string; description: string;
}
const EMPTY: Draft = { title: '', venue: '', city: '', startsAt: '', imageUrl: '', description: '' };
const INPUT = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none';

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/events', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setEvents(data.events);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: draft.title.trim(),
          venue: draft.venue.trim() || undefined,
          city: draft.city.trim() || undefined,
          description: draft.description.trim() || undefined,
          imageUrl: draft.imageUrl.trim() || undefined,
          startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not create the event');
      setDraft(EMPTY);
      setCreating(false);
      setMessage({ kind: 'ok', text: 'Event created. Add ticket tiers next.' });
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not create' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Events</h1>
          <p className="mt-2 text-gray-600">
            Concerts and shows you sell tickets to. Add tiers on each event. The store must be on under Feature Toggles.
          </p>
        </div>
        <button
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700"
        >
          <Plus size={18} /> New event
        </button>
      </div>

      {message && (
        <div className={'mb-4 rounded-lg border p-3 text-sm ' + (message.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800')}>
          {message.text}
        </div>
      )}

      {creating && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 font-semibold text-gray-900">New event</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input className={INPUT + ' sm:col-span-2'} placeholder="Title (e.g. Detty December Concert)" value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <input className={INPUT} placeholder="Venue" value={draft.venue}
              onChange={(e) => setDraft({ ...draft, venue: e.target.value })} />
            <input className={INPUT} placeholder="City" value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
            <div>
              <label className="mb-1 block text-xs text-gray-500">Date &amp; time (optional)</label>
              <input className={INPUT} type="datetime-local" value={draft.startsAt}
                onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
            </div>
            <input className={INPUT} placeholder="Image URL (optional)" value={draft.imageUrl}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
            <textarea className={INPUT + ' sm:col-span-2'} rows={2} placeholder="Description (optional)" value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={create} disabled={busy || !draft.title.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {busy && <Loader2 size={16} className="animate-spin" />} Create event
            </button>
            <button onClick={() => { setCreating(false); setDraft(EMPTY); }} className="rounded-lg px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          <CalendarDays className="mx-auto mb-3 text-gray-300" size={40} />
          No events yet.
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => (
            <Link key={ev.id} href={`/events/${ev.id}`}
              className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-brand-300">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{ev.title}</div>
                  <div className="mt-0.5 text-sm text-gray-500">
                    {[ev.venue, ev.city].filter(Boolean).join(' · ') || 'No venue set'}
                    {ev.startsAt ? ` · ${new Date(ev.startsAt).toLocaleString('en-NG')}` : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ev.tiers.length === 0 ? (
                      <span className="text-xs text-amber-600">No tiers yet — add ticket types</span>
                    ) : ev.tiers.map((t) => (
                      <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        <Ticket size={11} /> {t.name} {t.priceFormatted}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <span className={'rounded-full px-2 py-1 text-xs font-semibold ' + (ev.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                    {ev.active ? 'Live' : 'Hidden'}
                  </span>
                  <div className="mt-2 text-sm font-semibold text-gray-900">{ev.soldCount} sold</div>
                  <div className="text-xs text-gray-500">{ev.revenueFormatted}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
