'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { CATEGORY_LABELS, templateFor } from '@/lib/gadgetCategories';

export interface SpecRow {
  label: string;
  value: string;
}

export interface ProductFormValues {
  name: string;
  price: string; // NGN decimal string
  category: string;
  description: string;
  imageUrl: string;
  stock: string; // "" = untracked
  active: boolean;
  specs: SpecRow[];
}

const INPUT_CLS =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none';
const LABEL_CLS = 'mb-1 block text-sm font-medium text-gray-700';

const OTHER = '__other__';

export const EMPTY_PRODUCT: ProductFormValues = {
  name: '',
  price: '',
  category: '',
  description: '',
  imageUrl: '',
  stock: '',
  active: true,
  specs: [],
};

export default function ProductForm({
  mode,
  productId,
  initial,
}: {
  mode: 'create' | 'edit';
  productId?: string;
  initial: ProductFormValues;
}) {
  const router = useRouter();
  const [v, setV] = useState<ProductFormValues>(initial);
  // A category not in the canonical list is edited as free text ("Other").
  const knownCategory = v.category === '' || CATEGORY_LABELS.includes(v.category);
  const [customCategory, setCustomCategory] = useState(knownCategory ? '' : v.category);
  const [useOther, setUseOther] = useState(!knownCategory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveCategory = useOther ? customCategory.trim() : v.category;

  function set<K extends keyof ProductFormValues>(key: K, val: ProductFormValues[K]) {
    setV((s) => ({ ...s, [key]: val }));
  }

  function setSpec(i: number, patch: Partial<SpecRow>) {
    setV((s) => ({ ...s, specs: s.specs.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  }
  function addSpec() {
    setV((s) => ({ ...s, specs: [...s.specs, { label: '', value: '' }] }));
  }
  function removeSpec(i: number) {
    setV((s) => ({ ...s, specs: s.specs.filter((_, j) => j !== i) }));
  }

  // Seed the spec editor from the chosen category's template, keeping any rows
  // the admin already filled in and appending only the labels not present yet.
  const template = useMemo(() => templateFor(effectiveCategory), [effectiveCategory]);
  function loadTemplate() {
    if (template.length === 0) return;
    setV((s) => {
      const have = new Set(s.specs.map((r) => r.label.trim().toLowerCase()));
      const filled = s.specs.filter((r) => r.label.trim() || r.value.trim());
      const additions = template
        .filter((t) => !have.has(t.label.toLowerCase()))
        .map((t) => ({ label: t.label, value: '' }));
      return { ...s, specs: [...filled, ...additions] };
    });
  }

  async function submit() {
    if (!v.name.trim()) return setError('Give the product a name.');
    if (!v.price.trim()) return setError('Set a price.');
    setBusy(true);
    setError(null);
    const body = {
      name: v.name.trim(),
      price: v.price.trim(),
      description: v.description.trim() || undefined,
      imageUrl: v.imageUrl.trim() || undefined,
      category: effectiveCategory || undefined,
      stock: v.stock.trim() === '' ? null : Number(v.stock),
      active: v.active,
      specs: v.specs
        .map((r) => ({ label: r.label.trim(), value: r.value.trim() }))
        .filter((r) => r.label || r.value),
    };
    try {
      const url = mode === 'create' ? '/api/gadgets' : `/api/gadgets/${productId}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save the product');
      router.push('/gadgets');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  const hintFor = (label: string) =>
    template.find((t) => t.label.toLowerCase() === label.trim().toLowerCase())?.hint;

  return (
    <div className="max-w-3xl">
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Basics */}
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 font-semibold text-gray-900">Basics</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Product name</label>
            <input
              className={INPUT_CLS}
              placeholder="e.g. Samsung Galaxy S24 Ultra"
              value={v.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Category</label>
            <select
              className={INPUT_CLS}
              value={useOther ? OTHER : v.category}
              onChange={(e) => {
                if (e.target.value === OTHER) {
                  setUseOther(true);
                } else {
                  setUseOther(false);
                  set('category', e.target.value);
                }
              }}
            >
              <option value="">Select a category…</option>
              {CATEGORY_LABELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={OTHER}>Other…</option>
            </select>
            {useOther && (
              <input
                className={INPUT_CLS + ' mt-2'}
                placeholder="Type a category"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
              />
            )}
          </div>

          <div>
            <label className={LABEL_CLS}>Price (₦)</label>
            <input
              className={INPUT_CLS}
              placeholder="e.g. 1250000"
              inputMode="decimal"
              value={v.price}
              onChange={(e) => set('price', e.target.value)}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Stock</label>
            <input
              className={INPUT_CLS}
              placeholder="Blank = not tracked"
              inputMode="numeric"
              value={v.stock}
              onChange={(e) => set('stock', e.target.value.replace(/\D/g, ''))}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Image URL</label>
            <input
              className={INPUT_CLS}
              placeholder="https://…"
              value={v.imageUrl}
              onChange={(e) => set('imageUrl', e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Description</label>
            <textarea
              className={INPUT_CLS}
              rows={3}
              placeholder="A short overview shown above the specs."
              value={v.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </div>

        {v.imageUrl.trim() ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.imageUrl.trim()}
            alt="Preview"
            className="mt-4 h-40 w-40 rounded-lg border border-gray-200 object-cover"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        ) : null}
      </section>

      {/* Specifications */}
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-gray-900">Specifications</h2>
            <p className="text-sm text-gray-500">
              The detail buyers compare on — display, storage, battery, and so on.
            </p>
          </div>
          {template.length > 0 && (
            <button
              type="button"
              onClick={loadTemplate}
              className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
            >
              <Wand2 size={16} /> Load {effectiveCategory} fields
            </button>
          )}
        </div>

        {v.specs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">
            {template.length > 0
              ? `No specs yet — “Load ${effectiveCategory} fields” to start from a template, or add your own.`
              : 'No specs yet. Pick a category above for a ready-made template, or add fields manually.'}
          </p>
        ) : (
          <div className="space-y-2">
            {v.specs.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={INPUT_CLS + ' w-1/3'}
                  placeholder="Label (e.g. RAM)"
                  value={row.label}
                  onChange={(e) => setSpec(i, { label: e.target.value })}
                />
                <input
                  className={INPUT_CLS + ' flex-1'}
                  placeholder={hintFor(row.label) ? `e.g. ${hintFor(row.label)}` : 'Value (e.g. 12 GB)'}
                  value={row.value}
                  onChange={(e) => setSpec(i, { value: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeSpec(i)}
                  className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Remove field"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addSpec}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <Plus size={16} /> Add field
        </button>
      </section>

      {/* Visibility + actions */}
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={v.active}
            onChange={(e) => set('active', e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm font-medium text-gray-700">
            Show in the storefront (uncheck to keep it hidden while you finish it)
          </span>
        </label>
      </section>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {mode === 'create' ? 'Add product' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/gadgets')}
          className="rounded-lg px-5 py-2.5 font-semibold text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
