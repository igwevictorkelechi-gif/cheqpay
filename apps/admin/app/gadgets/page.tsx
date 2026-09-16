'use client';

import { useEffect, useState } from 'react';
import { Plus, Package, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Product {
  id: string;
  name: string;
  description: string;
  priceMinor: string;
  priceFormatted: string;
  imageUrl: string | null;
  category: string;
  stock: number | null;
  available: boolean;
  active: boolean;
}

interface DraftFields {
  name: string;
  price: string;
  description: string;
  imageUrl: string;
  category: string;
  stock: string; // "" = untracked
  active: boolean;
}

const EMPTY_DRAFT: DraftFields = {
  name: '',
  price: '',
  description: '',
  imageUrl: '',
  category: '',
  stock: '',
  active: true,
};

/** Naira minor units → a plain decimal string for the price input. */
function minorToNaira(minor: string): string {
  return (Number(minor) / 100).toString();
}

const INPUT_CLS =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none';

function ProductRow({
  product,
  busy,
  onPatch,
}: {
  product: Product;
  busy: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [price, setPrice] = useState(minorToNaira(product.priceMinor));
  const [stock, setStock] = useState(product.stock === null ? '' : String(product.stock));
  const dirty =
    price !== minorToNaira(product.priceMinor) ||
    stock !== (product.stock === null ? '' : String(product.stock));

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-semibold text-gray-900">{product.name}</div>
        {product.category ? <div className="text-xs text-gray-500">{product.category}</div> : null}
      </td>
      <td className="px-4 py-3">
        <input className={INPUT_CLS + ' w-28'} value={price} inputMode="decimal"
          onChange={(e) => setPrice(e.target.value)} />
      </td>
      <td className="px-4 py-3">
        <input className={INPUT_CLS + ' w-20'} value={stock} placeholder="∞" inputMode="numeric"
          onChange={(e) => setStock(e.target.value.replace(/\D/g, ''))} />
      </td>
      <td className="px-4 py-3">
        <span className={'rounded-full px-2 py-1 text-xs font-semibold ' +
          (product.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
          {product.active ? (product.available ? 'Live' : 'Out of stock') : 'Hidden'}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <button
              disabled={busy}
              onClick={() => onPatch(product.id, {
                price: price.trim(),
                stock: stock.trim() === '' ? null : Number(stock),
              })}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Save
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => onPatch(product.id, { active: !product.active })}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {product.active ? 'Hide' : 'Show'}
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function GadgetCatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/gadgets', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setProducts(data.products);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function draftToBody(d: DraftFields) {
    return {
      name: d.name.trim(),
      price: d.price.trim(),
      description: d.description.trim() || undefined,
      imageUrl: d.imageUrl.trim() || undefined,
      category: d.category.trim() || undefined,
      stock: d.stock.trim() === '' ? null : Number(d.stock),
      active: d.active,
    };
  }

  async function create() {
    setBusy('create');
    setMessage(null);
    try {
      const res = await fetch('/api/gadgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draftToBody(draft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not create the product');
      setDraft(EMPTY_DRAFT);
      setCreating(false);
      setMessage({ kind: 'ok', text: 'Product added.' });
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not create' });
    } finally {
      setBusy(null);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/gadgets/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not update');
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not update' });
    } finally {
      setBusy(null);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none';

  return (
    <DashboardLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gadget Catalog</h1>
          <p className="mt-2 text-gray-600">
            Products shown in the app store. The store must be switched on under Feature Toggles.
          </p>
        </div>
        <button
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700"
        >
          <Plus size={18} /> Add product
        </button>
      </div>

      {message && (
        <div
          className={
            'mb-4 rounded-lg border p-3 text-sm ' +
            (message.kind === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {message.text}
        </div>
      )}

      {creating && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 font-semibold text-gray-900">New product</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className={inputCls} placeholder="Name" value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className={inputCls} placeholder="Price (₦, e.g. 45000)" value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
            <input className={inputCls} placeholder="Category (optional)" value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            <input className={inputCls} placeholder="Stock (blank = untracked)" value={draft.stock}
              inputMode="numeric"
              onChange={(e) => setDraft({ ...draft, stock: e.target.value.replace(/\D/g, '') })} />
            <input className={inputCls + ' col-span-2'} placeholder="Image URL (optional)" value={draft.imageUrl}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
            <textarea className={inputCls + ' col-span-2'} placeholder="Description (optional)" rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={create}
              disabled={busy === 'create' || !draft.name.trim() || !draft.price.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy === 'create' && <Loader2 size={16} className="animate-spin" />} Save product
            </button>
            <button onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT); }}
              className="rounded-lg px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          <Package className="mx-auto mb-3 text-gray-300" size={40} />
          No products yet. Add your first to stock the store.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Stock</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((p) => (
                <ProductRow key={p.id} product={p} busy={busy === p.id} onPatch={patch} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}
