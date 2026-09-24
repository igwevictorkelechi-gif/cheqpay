'use client';

// Pick an image from the computer, with a preview.
//
// The file is read into a base64 data URL and stored in the record's own
// image column — the same approach as bill-provider logos and gadget product
// images. There is no object store in this stack, so a data URL is what makes
// "upload an image" work at all; the size cap is what keeps that honest, since
// base64 inflates the stored string by about a third and the image ships inside
// the catalog JSON every customer loads.
//
// Oversized images are resized here rather than refused. A cap on its own would
// make the feature unusable in practice — an event poster or a photo off a phone
// is several megabytes, and "go and find an image editor" is not an answer.

import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';

/**
 * The stored limit, in characters of the data URL — this is what the server
 * actually enforces (lib/uploadedImage.ts, MAX_IMAGE_LEN). Base64 inflates the
 * bytes by about a third, so it is the string length, not the file size, that
 * has to fit.
 */
const MAX_IMAGE_CHARS = 400_000;

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Could not read the image file'));
    fr.readAsDataURL(file);
  });
}

/** Longest edge kept when an image is too big to store as-is. */
const MAX_EDGE_PX = 1600;

/**
 * Shrink an oversized image in the browser so it fits the cap.
 *
 * Without this the cap is unusable in practice: a poster or a photo off a phone
 * is 2–5MB, and nobody wants to be told to go and find an image editor. The
 * picture is drawn onto a canvas at a sane size and re-encoded as JPEG, dropping
 * quality step by step only until it fits.
 *
 * SVGs are left alone — they are already tiny and rasterising one would throw
 * away the thing that makes it an SVG. Anything we cannot decode is returned
 * unchanged, and the size check then rejects it with a clear message.
 */
async function shrinkToFit(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  if (file.type === 'image/svg+xml' || original.length <= MAX_IMAGE_CHARS) return original;

  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = original;
  });
  if (!img || !img.width || !img.height) return original;

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  // A white base, so a transparent PNG doesn't turn black once it is JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let best = original;
  for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
    const out = canvas.toDataURL('image/jpeg', quality);
    best = out;
    if (out.length <= MAX_IMAGE_CHARS) return out;
  }
  return best;
}

interface Props {
  /** Current value: a data URL, an https URL, or "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** Shown above the control. Omit for no label. */
  label?: string;
  /** Surfaced to the caller so it can show the message in its own error slot. */
  onError?: (message: string) => void;
  disabled?: boolean;
  /** Preview box size. Events are wide; products are square. */
  shape?: 'square' | 'wide';
}

export default function ImageUploadField({
  value,
  onChange,
  label,
  onError,
  disabled,
  shape = 'square',
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const current = value.trim();

  function fail(message: string) {
    setLocalError(message);
    onError?.(message);
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    setLocalError(null);
    if (!file.type.startsWith('image/')) {
      fail('Please choose an image file (PNG, JPG, WebP, or SVG).');
      return;
    }
    setReading(true);
    try {
      // Big images are shrunk rather than refused, so a poster straight off a
      // phone just works. Only something that still will not fit is rejected.
      const dataUrl = await shrinkToFit(file);
      if (dataUrl.length > MAX_IMAGE_CHARS) {
        fail(
          file.type === 'image/svg+xml'
            ? 'That SVG is too large. Please use one under 300KB.'
            : 'That image is too large to store even after resizing. Please use a smaller one.',
        );
        return;
      }
      onChange(dataUrl);
    } catch {
      fail('Could not read that image. Try another file.');
    } finally {
      setReading(false);
      // Let the same file be chosen again after a remove.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const box = shape === 'wide' ? 'h-24 w-40' : 'h-24 w-24';

  return (
    <div>
      {label ? <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label> : null}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <div className="flex items-center gap-4">
        <div
          className={
            'flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 ' +
            box
          }
        >
          {reading ? (
            <Loader2 size={20} className="animate-spin text-gray-300" />
          ) : current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
            />
          ) : (
            <ImagePlus size={22} className="text-gray-300" />
          )}
        </div>
        <div>
          <button
            type="button"
            disabled={disabled || reading}
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <ImagePlus size={16} /> {current ? 'Replace image' : 'Upload image'}
          </button>
          {current ? (
            <button
              type="button"
              disabled={disabled || reading}
              onClick={() => {
                setLocalError(null);
                onChange('');
              }}
              className="ml-2 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Remove
            </button>
          ) : null}
          <p className="mt-1 text-xs text-gray-500">PNG, JPG, WebP or SVG. Large images are resized automatically.</p>
          {localError ? <p className="mt-1 text-xs text-red-600">{localError}</p> : null}
        </div>
      </div>
    </div>
  );
}
