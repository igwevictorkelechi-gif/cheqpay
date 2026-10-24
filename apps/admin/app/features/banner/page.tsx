'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Image as ImageIcon, Pencil, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Banner = {
  id: string;
  version: string;
  enabled: boolean;
  imageUrl: string | null;
  title: string | null;
  message: string | null;
  linkUrl: string | null;
};
type Draft = Omit<Banner, 'id' | 'version'> & { id?: string };

const EMPTY: Draft = { enabled: true, imageUrl: null, title: null, message: null, linkUrl: null };

/** The slot on the home screen: full width less 20px each side, 128px tall. */
const SLOT_HEIGHT = 128;
/** Largest data URL we send; the API takes up to 900 KB of text. */
const MAX_DATA_URL = 850_000;

/**
 * Shrink an upload to at most 1200px wide and keep whichever of WebP or JPEG
 * comes out smaller: the slot is never wider than a phone, and every byte is
 * sent to every phone once. (Safari can't write WebP and hands back PNG.)
 */
async function toBannerDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const best = [canvas.toDataURL('image/webp', 0.88), canvas.toDataURL('image/jpeg', 0.88)].sort((a, b) => a.length - b.length)[0];
  if (best.length > MAX_DATA_URL) throw new Error('That image is still too large after shrinking. Try a simpler one.');
  return best;
}

/** One banner exactly as the home screen draws it. */
function BannerPreview({ banner }: { banner: Draft }) {
  const hasText = Boolean(banner.title || banner.message);
  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl"
      style={{ height: SLOT_HEIGHT, background: 'linear-gradient(120deg,#6B5B95,#8A7BB5)' }}
    >
      {banner.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {hasText && (
        <div
          className="absolute inset-0 flex flex-col justify-center px-5"
          style={{ background: banner.imageUrl ? 'linear-gradient(90deg,rgba(0,0,0,0.65),rgba(0,0,0,0.1))' : undefined }}
        >
          {banner.title && <p className="line-clamp-1 text-base font-bold text-white">{banner.title}</p>}
          {banner.message && <p className="mt-1 line-clamp-2 max-w-[85%] text-sm text-white/85">{banner.message}</p>}
        </div>
      )}
      {!banner.imageUrl && !hasText && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Your banner shows here</div>
      )}
    </div>
  );
}

export default function HomeBannerAdminPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [max, setMax] = useState(8);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await fetch('/api/home-banner', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to load');
      setBanners(d.banners ?? []);
      if (d.max) setMax(d.max);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    try {
      const imageUrl = await toBannerDataUrl(file);
      setDraft((b) => (b ? { ...b, imageUrl } : b));
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not read that image.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(draft.id ? `/api/home-banner/${draft.id}` : '/api/home-banner', {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: draft.enabled,
          imageUrl: draft.imageUrl || null,
          title: draft.title?.trim() || null,
          message: draft.message?.trim() || null,
          linkUrl: draft.linkUrl?.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to save');
      setDraft(null);
      setMessage({ kind: 'ok', text: draft.enabled ? 'Saved and live in the carousel.' : 'Saved, switched off: users won’t see it.' });
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(b: Banner) {
    if (!confirm(`Delete this banner${b.title ? ` (“${b.title}”)` : ''}? This can’t be undone.`)) return;
    setMessage(null);
    const res = await fetch(`/api/home-banner/${b.id}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setMessage({ kind: 'err', text: d.error ?? 'Failed to delete' });
    if (draft?.id === b.id) setDraft(null);
    await load();
  }

  async function toggle(b: Banner) {
    setMessage(null);
    const res = await fetch(`/api/home-banner/${b.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !b.enabled, imageUrl: b.imageUrl, title: b.title, message: b.message, linkUrl: b.linkUrl }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setMessage({ kind: 'err', text: d.error ?? 'Failed to save' });
    await load();
  }

  /** Move the banner at `from` to `to` and save the new order. */
  async function move(from: number, to: number) {
    if (from === to || to < 0 || to >= banners.length) return;
    const next = [...banners];
    const [b] = next.splice(from, 1);
    next.splice(to, 0, b);
    setBanners(next);
    const res = await fetch('/api/home-banner/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: next.map((x) => x.id) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setMessage({ kind: 'err', text: d.error ?? 'Failed to reorder' });
    await load();
  }

  const live = banners.filter((b) => b.enabled).length;
  const canSave = Boolean(draft && (draft.imageUrl || draft.title?.trim())) && !saving;
  const inputCls = 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Home Banners</h1>
        <p className="text-gray-600 mt-2">
          Banners in the slot under Deposit · Withdraw · Convert · Send, in place of the Cash card, on the website
          and in the app. With more than one live, they slide by every 5 seconds in the order below, and users can
          swipe between them. With none live, users see the Cash card.
        </p>
      </div>

      {message && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm max-w-5xl ${message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Carousel</h2>
                <p className="text-xs text-gray-500">{live} live · {banners.length} of {max} · drag to reorder</p>
              </div>
              <button
                onClick={() => setDraft({ ...EMPTY })}
                disabled={banners.length >= max}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold disabled:opacity-40"
              >
                <Plus size={16} /> Add banner
              </button>
            </div>

            {banners.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500">No banners yet. Users see the Cash card.</p>
            ) : (
              <ul className="space-y-2">
                {banners.map((b, i) => (
                  <li
                    key={b.id}
                    draggable
                    onDragStart={() => setDragFrom(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFrom !== null) void move(dragFrom, i);
                      setDragFrom(null);
                    }}
                    onDragEnd={() => setDragFrom(null)}
                    className={`flex items-center gap-3 rounded-lg border p-2 ${draft?.id === b.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200'} ${dragFrom === i ? 'opacity-50' : ''}`}
                  >
                    <GripVertical size={18} className="shrink-0 cursor-grab text-gray-400" aria-hidden />
                    <span className="w-5 shrink-0 text-center text-xs font-semibold text-gray-400">{i + 1}</span>
                    <div className="h-10 w-28 shrink-0 overflow-hidden rounded-md" style={{ background: 'linear-gradient(120deg,#6B5B95,#8A7BB5)' }}>
                      {b.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.imageUrl} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{b.title || 'Image banner'}</p>
                      <p className="truncate text-xs text-gray-500">{b.linkUrl ? `Opens ${b.linkUrl}` : 'Not tappable'}</p>
                    </div>
                    <button
                      onClick={() => void toggle(b)}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${b.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      title={b.enabled ? 'Switch off' : 'Switch on'}
                    >
                      {b.enabled ? 'Live' : 'Off'}
                    </button>
                    <div className="flex shrink-0 flex-col">
                      <button onClick={() => void move(i, i - 1)} disabled={i === 0} aria-label="Move up" className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                        <ArrowUp size={14} />
                      </button>
                      <button onClick={() => void move(i, i + 1)} disabled={i === banners.length - 1} aria-label="Move down" className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                        <ArrowDown size={14} />
                      </button>
                    </div>
                    <button onClick={() => setDraft({ ...b })} aria-label="Edit" className="shrink-0 p-1 text-gray-500 hover:text-brand-600">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => void remove(b)} aria-label="Delete" className="shrink-0 p-1 text-gray-400 hover:text-red-600">
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {draft ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon size={20} className="text-brand-600" />
                  <h2 className="text-lg font-bold text-gray-900">{draft.id ? 'Edit banner' : 'New banner'}</h2>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-sm font-semibold text-gray-700">{draft.enabled ? 'Live' : 'Off'}</span>
                    <button
                      role="switch"
                      aria-checked={draft.enabled}
                      onClick={() => setDraft((b) => (b ? { ...b, enabled: !b.enabled } : b))}
                      className={'relative h-7 w-12 rounded-full transition-colors ' + (draft.enabled ? 'bg-brand-600' : 'bg-gray-300')}
                    >
                      <span className={'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ' + (draft.enabled ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </label>
                  <button onClick={() => setDraft(null)} aria-label="Close" className="text-gray-400 hover:text-gray-700">
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="rounded-2xl p-4" style={{ backgroundColor: '#0b0a10' }}>
                <BannerPreview banner={draft} />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Banner image</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Upload size={15} /> Upload
                  </button>
                  {draft.imageUrl && (
                    <button
                      onClick={() => setDraft((b) => (b ? { ...b, imageUrl: null } : b))}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={15} /> Remove
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pickImage(e.target.files?.[0])} />
                <p className="text-xs text-gray-500 mt-2">
                  Best at <span className="font-medium">1200 × 400 px</span>. Phones trim up to about 100px off the left and right
                  edges, so keep words and logos at least 130px in from the sides.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Title (optional)</label>
                <input value={draft.title ?? ''} onChange={(e) => setDraft((b) => (b ? { ...b, title: e.target.value } : b))} maxLength={40} placeholder="Zero fees this weekend" className={inputCls} />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Text (optional)</label>
                <textarea
                  value={draft.message ?? ''}
                  onChange={(e) => setDraft((b) => (b ? { ...b, message: e.target.value } : b))}
                  maxLength={90}
                  rows={2}
                  placeholder="Deposit and pay bills free until Sunday."
                  className={inputCls + ' resize-none'}
                />
                <p className="text-xs text-gray-500 mt-1">Leave both empty if the words are already in your image.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Opens when tapped (optional)</label>
                <input value={draft.linkUrl ?? ''} onChange={(e) => setDraft((b) => (b ? { ...b, linkUrl: e.target.value } : b))} maxLength={300} placeholder="/crypto or https://…" className={inputCls} />
              </div>

              <button onClick={save} disabled={!canSave} className="flex items-center gap-2 px-5 py-3 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
                <Save size={18} />
                {saving ? 'Saving…' : draft.id ? 'Save banner' : 'Add to carousel'}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 flex items-center justify-center text-center">
              Pick a banner to edit, or add a new one.
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
