'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Package, Loader2, Pencil } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Product {
  id: string;
  name: string;
  description: string;
  priceMinor: string;
  priceFormatted: string;
  imageUrl: string | null;
  category: string;
  specs: { label: string; value: string }[];
  stock: number | null;
  available: boolean;
  active: boolean;
}

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
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Package size={16} className="text-gray-400" />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-gray-900">{product.name}</div>
            <div className="text-xs text-gray-500">
              {product.category || 'Uncategorised'}
              {product.specs.length > 0 ? ` · ${product.specs.length} specs` : ''}
            </div>
          </div>
        </div>
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
          <Link
            href={`/gadgets/${product.id}/edit`}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Pencil size={13} /> Edit
          </Link>
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
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

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

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set).sort();
  }, [products]);

  const shown = filter ? products.filter((p) => p.category === filter) : products;

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gadget Catalog</h1>
          <p className="mt-2 text-gray-600">
            Products shown in the app store. The store must be switched on under Feature Toggles.
          </p>
        </div>
        <Link
          href="/gadgets/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700"
        >
          <Plus size={18} /> Add product
        </Link>
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

      {categories.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('')}
            className={
              'rounded-full px-3 py-1.5 text-sm font-semibold ' +
              (filter === '' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
            }
          >
            All ({products.length})
          </button>
          {categories.map((c) => {
            const count = products.filter((p) => p.category === c).length;
            return (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={
                  'rounded-full px-3 py-1.5 text-sm font-semibold ' +
                  (filter === c ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
                }
              >
                {c} ({count})
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          <Package className="mx-auto mb-3 text-gray-300" size={40} />
          No products yet.{' '}
          <Link href="/gadgets/new" className="font-semibold text-brand-600 hover:underline">
            Add your first
          </Link>{' '}
          to stock the store.
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
              {shown.map((p) => (
                <ProductRow key={p.id} product={p} busy={busy === p.id} onPatch={patch} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}
