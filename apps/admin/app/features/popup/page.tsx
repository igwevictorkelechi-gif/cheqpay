'use client';

import { useEffect, useRef, useState } from 'react';
import { Megaphone, Save, Upload, Trash2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Popup = {
  id?: string;
  enabled: boolean;
  title: string;
  message: string;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
};

const EMPTY: Popup = {
  enabled: false,
  title: '',
  message: '',
  imageUrl: null,
  buttonText: null,
  buttonUrl: null,
};

export default function PopupAdminPage() {
  const [popup, setPopup] = useState<Popup>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/popup', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.popup) setPopup(d.popup); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (file.size > 600_000) {
      setMessage({ kind: 'err', text: 'Image too large — keep it under 600 KB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPopup((p) => ({ ...p, imageUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/popup', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: popup.enabled,
          title: popup.title.trim(),
          message: popup.message.trim(),
          imageUrl: popup.imageUrl || null,
          buttonText: popup.buttonText?.trim() || null,
          buttonUrl: popup.buttonUrl?.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to save');
      setPopup(d.popup);
      setMessage({
        kind: 'ok',
        text: popup.enabled
          ? 'Saved and live — every user sees it once on their next visit.'
          : 'Saved (disabled — users will not see it).',
      });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  const canSave = popup.title.trim().length > 0 && popup.message.trim().length > 0 && !saving;
  const inputCls =
    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">In-App Popup</h1>
        <p className="text-gray-600 mt-2">
          Show an announcement or promo to every user, once. Saving publishes a fresh popup —
          users who dismissed an older one will see the new version.
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
          {/* Editor */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone size={20} className="text-brand-600" />
                <h2 className="text-lg font-bold text-gray-900">Content</h2>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm font-semibold text-gray-700">{popup.enabled ? 'Live' : 'Off'}</span>
                <button
                  role="switch"
                  aria-checked={popup.enabled}
                  onClick={() => setPopup((p) => ({ ...p, enabled: !p.enabled }))}
                  className={
                    'relative h-7 w-12 rounded-full transition-colors ' +
                    (popup.enabled ? 'bg-brand-600' : 'bg-gray-300')
                  }
                >
                  <span
                    className={
                      'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ' +
                      (popup.enabled ? 'translate-x-5' : 'translate-x-0.5')
                    }
                  />
                </button>
              </label>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Title</label>
              <input
                value={popup.title}
                onChange={(e) => setPopup((p) => ({ ...p, title: e.target.value }))}
                maxLength={80}
                placeholder="🎉 Zero fees this weekend!"
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Message</label>
              <textarea
                value={popup.message}
                onChange={(e) => setPopup((p) => ({ ...p, message: e.target.value }))}
                maxLength={500}
                rows={4}
                placeholder="Deposit and pay bills with zero fees until Sunday."
                className={inputCls + ' resize-none'}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Image (optional)</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Upload size={15} /> Upload
                </button>
                {popup.imageUrl && (
                  <button
                    onClick={() => setPopup((p) => ({ ...p, imageUrl: null }))}
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
                onChange={(e) => pickImage(e.target.files?.[0])}
              />
              <p className="text-xs text-gray-500 mt-2">PNG/JPG/WebP up to 600 KB. Landscape works best.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Button text</label>
                <input
                  value={popup.buttonText ?? ''}
                  onChange={(e) => setPopup((p) => ({ ...p, buttonText: e.target.value }))}
                  maxLength={30}
                  placeholder="Deposit now"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Button link</label>
                <input
                  value={popup.buttonUrl ?? ''}
                  onChange={(e) => setPopup((p) => ({ ...p, buttonUrl: e.target.value }))}
                  maxLength={300}
                  placeholder="/deposit or https://…"
                  className={inputCls}
                />
              </div>
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

          {/* Live preview (phone-style, dark like the app) */}
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Preview</h2>
            <div
              className="rounded-3xl p-6 flex items-center justify-center"
              style={{ backgroundColor: '#0b0a10', minHeight: 420 }}
            >
              <div
                className="w-full max-w-[300px] rounded-3xl overflow-hidden"
                style={{ backgroundColor: '#1F1B29', border: '1px solid #2A2535' }}
              >
                {popup.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={popup.imageUrl} alt="" className="w-full h-36 object-cover" />
                )}
                <div className="p-5">
                  <p className="font-bold text-base" style={{ color: '#F4F3F7' }}>
                    {popup.title || 'Popup title'}
                  </p>
                  <p className="text-sm mt-2 leading-relaxed" style={{ color: '#9A93AD' }}>
                    {popup.message || 'Your message shows here.'}
                  </p>
                  <div
                    className="mt-4 rounded-full py-3 text-center text-sm font-bold text-white"
                    style={{ background: 'linear-gradient(90deg,#6B5B95,#8A7BB5)' }}
                  >
                    {popup.buttonText || 'Got it'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
