'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, ImageIcon } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Biller {
  id: string;
  name: string;
  short: string;
  color: string;
  service: string;
  serviceLabel: string;
  logo: string | null;
  hasUpload: boolean;
}

const MAX_BYTES = 300 * 1024; // 300 KB

function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff';
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Could not read file'));
    fr.readAsDataURL(file);
  });
}

export default function BillLogosPage() {
  const [billers, setBillers] = useState<Biller[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/bill-logos', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setBillers(data.billers);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function upload(biller: Biller, file: File) {
    setMessage(null);
    if (!file.type.startsWith('image/')) {
      setMessage({ kind: 'err', text: 'Please choose an image file (PNG, SVG, JPG, WebP).' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage({ kind: 'err', text: 'Image must be under 300KB. Try a smaller/optimised file.' });
      return;
    }
    setBusy(biller.id);
    try {
      const logo = await readAsDataUrl(file);
      const res = await fetch('/api/bill-logos', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ billerId: biller.id, logo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      setBillers((prev) =>
        prev.map((b) => (b.id === biller.id ? { ...b, logo, hasUpload: true } : b))
      );
      setMessage({ kind: 'ok', text: `${biller.name} logo updated.` });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Upload failed' });
    } finally {
      setBusy(null);
    }
  }

  async function remove(biller: Biller) {
    setBusy(biller.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/bill-logos?billerId=${encodeURIComponent(biller.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Remove failed');
      setBillers((prev) =>
        prev.map((b) => (b.id === biller.id ? { ...b, logo: null, hasUpload: false } : b))
      );
      setMessage({ kind: 'ok', text: `${biller.name} logo removed.` });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Remove failed' });
    } finally {
      setBusy(null);
    }
  }

  // Group billers by service for display.
  const groups = billers.reduce<Record<string, Biller[]>>((acc, b) => {
    (acc[b.serviceLabel] ??= []).push(b);
    return acc;
  }, {});

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Bill Provider Logos</h1>
        <p className="text-gray-600 mt-2">
          Upload official brand logos for each bill provider. Square PNG or SVG on a
          transparent background works best (under 300KB). Providers without an uploaded
          logo show a branded wordmark tile.
        </p>
      </div>

      {message && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading providers…</p>
      ) : (
        <div className="space-y-8">
          {Object.entries(groups).map(([label, list]) => (
            <div key={label}>
              <h2 className="mb-3 text-lg font-semibold text-gray-800">{label}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    {/* Preview */}
                    {b.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={b.logo}
                        alt={b.name}
                        className="h-14 w-14 shrink-0 rounded-xl bg-white object-contain p-1 ring-1 ring-gray-200"
                      />
                    ) : (
                      <span
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold"
                        style={{ background: b.color, color: contrastText(b.color) }}
                      >
                        {b.short}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-gray-900">{b.name}</p>
                      <p className="text-xs text-gray-500">
                        {b.hasUpload ? 'Custom logo' : 'Default wordmark'}
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        <button
                          onClick={() => inputs.current[b.id]?.click()}
                          disabled={busy === b.id}
                          className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                        >
                          <Upload size={15} />
                          {busy === b.id ? 'Saving…' : 'Upload'}
                        </button>
                        {b.hasUpload && (
                          <button
                            onClick={() => remove(b)}
                            disabled={busy === b.id}
                            className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            <Trash2 size={15} />
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    <input
                      ref={(el) => {
                        inputs.current[b.id] = el;
                      }}
                      type="file"
                      accept="image/png,image/svg+xml,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload(b, f);
                        e.target.value = '';
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {billers.length === 0 && (
            <div className="flex items-center gap-2 text-gray-500">
              <ImageIcon size={18} /> No providers found.
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
