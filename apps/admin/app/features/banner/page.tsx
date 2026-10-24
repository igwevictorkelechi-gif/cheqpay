'use client';

import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Save, Upload, Trash2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Banner = {
  id?: string;
  enabled: boolean;
  imageUrl: string | null;
  title: string | null;
  message: string | null;
  linkUrl: string | null;
};

const EMPTY: Banner = { enabled: false, imageUrl: null, title: null, message: null, linkUrl: null };

/** The slot on the home screen: full width less 20px each side, 128px tall. */
const SLOT_HEIGHT = 128;
/** Largest data URL we send; the API takes up to 900 KB of text. */
const MAX_DATA_URL = 850_000;

/**
 * Shrink an upload to at most 1200px wide before it is stored: the slot is
 * never wider than a phone, and every byte is sent to every phone once.
 */
async function toBannerDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // WebP keeps transparency; browsers that can't write it return PNG instead.
  let url = canvas.toDataURL('image/webp', 0.85);
  if (url.length > MAX_DATA_URL) url = canvas.toDataURL('image/jpeg', 0.8);
  if (url.length > MAX_DATA_URL) throw new Error('That image is still too large after shrinking. Try a simpler one.');
  return url;
}

/** The banner exactly as the home screen draws it. */
function BannerPreview({ banner }: { banner: Banner }) {
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
  const [banner, setBanner] = useState<Banner>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/home-banner', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.banner) setBanner(d.banner); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    try {
      const imageUrl = await toBannerDataUrl(file);
      setBanner((b) => ({ ...b, imageUrl }));
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not read that image.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/home-banner', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: banner.enabled,
          imageUrl: banner.imageUrl || null,
          title: banner.title?.trim() || null,
          message: banner.message?.trim() || null,
          linkUrl: banner.linkUrl?.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to save');
      setBanner(d.banner);
      setMessage({
        kind: 'ok',
        text: banner.enabled
          ? 'Saved and live: it replaces the Cash card on everyone’s home screen.'
          : 'Saved, but switched off: users keep seeing the Cash card.',
      });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  const canSave = Boolean(banner.imageUrl || banner.title?.trim()) && !saving;
  const inputCls =
    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Home Banner</h1>
        <p className="text-gray-600 mt-2">
          A banner in the slot under Deposit · Withdraw · Convert · Send on the home screen, in place of the
          Cash card. Same size as that card, on the website and in the app.
        </p>
      </div>

      {message && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm max-w-4xl ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon size={20} className="text-brand-600" />
                <h2 className="text-lg font-bold text-gray-900">Content</h2>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm font-semibold text-gray-700">{banner.enabled ? 'Live' : 'Off'}</span>
                <button
                  role="switch"
                  aria-checked={banner.enabled}
                  onClick={() => setBanner((b) => ({ ...b, enabled: !b.enabled }))}
                  className={'relative h-7 w-12 rounded-full transition-colors ' + (banner.enabled ? 'bg-brand-600' : 'bg-gray-300')}
                >
                  <span
                    className={
                      'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ' +
                      (banner.enabled ? 'translate-x-5' : 'translate-x-0.5')
                    }
                  />
                </button>
              </label>
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
                {banner.imageUrl && (
                  <button
                    onClick={() => setBanner((b) => ({ ...b, imageUrl: null }))}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={15} /> Remove
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void pickImage(e.target.files?.[0])}
              />
              <p className="text-xs text-gray-500 mt-2">
                Best at <span className="font-medium">1050 × 384 px</span> (about 2.7 : 1). It fills the slot and is
                cropped on narrow phones, so keep words and logos away from the edges.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Title (optional)</label>
              <input
                value={banner.title ?? ''}
                onChange={(e) => setBanner((b) => ({ ...b, title: e.target.value }))}
                maxLength={40}
                placeholder="Zero fees this weekend"
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Text (optional)</label>
              <textarea
                value={banner.message ?? ''}
                onChange={(e) => setBanner((b) => ({ ...b, message: e.target.value }))}
                maxLength={90}
                rows={2}
                placeholder="Deposit and pay bills free until Sunday."
                className={inputCls + ' resize-none'}
              />
              <p className="text-xs text-gray-500 mt-1">
                Leave both empty if the words are already in your image.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Opens when tapped (optional)</label>
              <input
                value={banner.linkUrl ?? ''}
                onChange={(e) => setBanner((b) => ({ ...b, linkUrl: e.target.value }))}
                maxLength={300}
                placeholder="/deposit or https://…"
                className={inputCls}
              />
            </div>

            <button
              onClick={save}
              disabled={!canSave}
              className="flex items-center gap-2 px-5 py-3 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              <Save size={18} />
              {saving ? 'Publishing…' : 'Save & publish'}
            </button>
          </div>

          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Preview</h2>
            <div className="rounded-3xl p-5 mx-auto" style={{ backgroundColor: '#0b0a10', width: 390 }}>
              <div className="mb-4 flex justify-between px-3 text-xs" style={{ color: '#9A93AD' }}>
                <span>Deposit</span>
                <span>Withdraw</span>
                <span>Convert</span>
                <span>Send</span>
              </div>
              <BannerPreview banner={banner} />
              <p className="mt-4 text-sm font-semibold" style={{ color: '#8A7BB5' }}>Transactions ›</p>
            </div>
            <p className="text-xs text-gray-500 mt-3 text-center">Shown at an iPhone&apos;s width: 350 × 128 px.</p>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
