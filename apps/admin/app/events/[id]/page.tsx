'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, Plus, Trash2, Ticket } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import ImageUploadField from '@/components/ImageUploadField';

interface Tier {
  id: string; name: string; priceMinor: string; priceFormatted: string;
  capacity: number | null; sold: number; active: boolean; sortOrder: number;
}
interface EventDetail {
  id: string; title: string; venue: string; city: string; startsAt: string | null;
  imageUrl: string | null;
  active: boolean; tiers: Tier[]; soldCount: number; revenueFormatted: string;
}
interface Attendee {
  id: string; reference: string; tierName: string; status: string; holderEmail: string | null; usedAt: string | null;
}

const INPUT = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none';
function minorToNaira(m: string) { return (Number(m) / 100).toString(); }

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tierDraft, setTierDraft] = useState({ name: '', price: '', capacity: '' });
  // Image is edited locally and saved explicitly, so picking a file by mistake
  // doesn't immediately change what customers see.
  const [imageDraft, setImageDraft] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, t] = await Promise.all([
        fetch(`/api/events/${id}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/events/${id}/tickets`, { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (e.error) throw new Error(e.error);
      setEv(e.event);
      setImageDraft(null);
      setAttendees(Array.isArray(t.tickets) ? t.tickets : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patchEvent(body: Record<string, unknown>) {
    setBusy('event');
    try {
      const res = await fetch(`/api/events/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  async function addTier() {
    setBusy('add-tier');
    setError(null);
    try {
      const res = await fetch(`/api/events/${id}/tiers`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: tierDraft.name.trim(),
          price: tierDraft.price.trim(),
          capacity: tierDraft.capacity.trim() === '' ? null : Number(tierDraft.capacity),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not add tier');
      setTierDraft({ name: '', price: '', capacity: '' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  async function patchTier(tierId: string, body: Record<string, unknown>) {
    setBusy(tierId);
    try {
      const res = await fetch(`/api/events/tiers/${tierId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  async function deleteTier(tierId: string) {
    if (!confirm('Remove this tier? If any are sold it will be hidden instead of deleted.')) return;
    setBusy(tierId);
    try {
      const res = await fetch(`/api/events/tiers/${tierId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  return (
    <DashboardLayout>
      <Link href="/events" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} /> Back to events
      </Link>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {!ev ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{ev.title}</h1>
              <p className="mt-1 text-gray-600">
                {[ev.venue, ev.city].filter(Boolean).join(' · ') || 'No venue set'}
                {ev.startsAt ? ` · ${new Date(ev.startsAt).toLocaleString('en-NG')}` : ''}
              </p>
              <p className="mt-1 text-sm text-gray-500">{ev.soldCount} sold · {ev.revenueFormatted} revenue</p>
            </div>
            <button
              disabled={busy === 'event'}
              onClick={() => patchEvent({ active: !ev.active })}
              className={'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ' + (ev.active ? 'border border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-brand-600 text-white hover:bg-brand-700')}
            >
              {ev.active ? 'Hide from store' : 'Publish to store'}
            </button>
          </div>

          {/* Event image */}
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 font-semibold text-gray-900">Event image</h2>
            <ImageUploadField
              shape="wide"
              disabled={busy === 'event'}
              value={imageDraft ?? ev.imageUrl ?? ''}
              onChange={setImageDraft}
              onError={setError}
            />
            {imageDraft !== null && imageDraft !== (ev.imageUrl ?? '') ? (
              <div className="mt-4 flex gap-3">
                <button
                  disabled={busy === 'event'}
                  onClick={() => void patchEvent({ imageUrl: imageDraft || null })}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy === 'event' && <Loader2 size={16} className="animate-spin" />} Save image
                </button>
                <button
                  disabled={busy === 'event'}
                  onClick={() => setImageDraft(null)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-gray-500">
                Shown on the event card and its page in the app. Wide images (16:9) look best.
              </p>
            )}
          </section>

          {/* Tiers */}
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 font-semibold text-gray-900">Ticket tiers</h2>

            <div className="mb-4 space-y-2">
              {ev.tiers.length === 0 && <p className="text-sm text-gray-400">No tiers yet — add one below.</p>}
              {ev.tiers.map((t) => (
                <TierRow key={t.id} tier={t} busy={busy === t.id} onPatch={patchTier} onDelete={deleteTier} />
              ))}
            </div>

            <div className="flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row">
              <input className={INPUT} placeholder="Tier name (e.g. VIP)" value={tierDraft.name}
                onChange={(e) => setTierDraft({ ...tierDraft, name: e.target.value })} />
              <input className={INPUT + ' sm:w-40'} placeholder="Price ₦" inputMode="decimal" value={tierDraft.price}
                onChange={(e) => setTierDraft({ ...tierDraft, price: e.target.value })} />
              <input className={INPUT + ' sm:w-40'} placeholder="Capacity (∞)" inputMode="numeric" value={tierDraft.capacity}
                onChange={(e) => setTierDraft({ ...tierDraft, capacity: e.target.value.replace(/\D/g, '') })} />
              <button onClick={addTier} disabled={busy === 'add-tier' || !tierDraft.name.trim() || !tierDraft.price.trim()}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                <Plus size={16} /> Add tier
              </button>
            </div>
          </section>

          {/* Attendees */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 font-semibold text-gray-900">Attendees ({attendees.length})</h2>
            {attendees.length === 0 ? (
              <p className="text-sm text-gray-400">No tickets sold yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-500">
                    <tr><th className="py-2">Reference</th><th className="py-2">Tier</th><th className="py-2">Holder</th><th className="py-2">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {attendees.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2 font-mono text-xs">{a.reference}</td>
                        <td className="py-2">{a.tierName}</td>
                        <td className="py-2 text-gray-600">{a.holderEmail ?? '—'}</td>
                        <td className="py-2">
                          <span className={'rounded-full px-2 py-0.5 text-xs font-semibold ' +
                            (a.status === 'USED' ? 'bg-blue-100 text-blue-700' : a.status === 'VALID' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                            {a.status === 'USED' ? 'Checked in' : a.status === 'VALID' ? 'Valid' : a.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </DashboardLayout>
  );
}

function TierRow({ tier, busy, onPatch, onDelete }: {
  tier: Tier; busy: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [price, setPrice] = useState(minorToNaira(tier.priceMinor));
  const [capacity, setCapacity] = useState(tier.capacity === null ? '' : String(tier.capacity));
  const dirty = price !== minorToNaira(tier.priceMinor) || capacity !== (tier.capacity === null ? '' : String(tier.capacity));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3">
      <span className="flex items-center gap-1.5 font-semibold text-gray-900"><Ticket size={14} /> {tier.name}</span>
      <span className="text-xs text-gray-500">{tier.sold} sold{tier.capacity !== null ? ` / ${tier.capacity}` : ''}</span>
      <div className="ml-auto flex items-center gap-2">
        <input className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm" value={price} inputMode="decimal"
          onChange={(e) => setPrice(e.target.value)} />
        <input className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm" value={capacity} placeholder="∞" inputMode="numeric"
          onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} />
        {dirty && (
          <button disabled={busy} onClick={() => onPatch(tier.id, { price: price.trim(), capacity: capacity.trim() === '' ? null : Number(capacity) })}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50">Save</button>
        )}
        <button disabled={busy} onClick={() => onPatch(tier.id, { active: !tier.active })}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {tier.active ? 'Hide' : 'Show'}
        </button>
        <button disabled={busy} onClick={() => onDelete(tier.id)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-50" aria-label="Remove"><Trash2 size={15} /></button>
      </div>
    </div>
  );
}
