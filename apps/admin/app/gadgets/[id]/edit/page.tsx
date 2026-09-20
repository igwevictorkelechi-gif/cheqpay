'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import ProductForm, { type ProductFormValues } from '@/components/ProductForm';

interface Product {
  id: string;
  name: string;
  description: string;
  priceMinor: string;
  compareAtMinor: string | null;
  category: string;
  imageUrl: string | null;
  stock: number | null;
  active: boolean;
  specs: { label: string; value: string }[];
}

/** Naira minor units → a plain decimal string for the price input. */
function minorToNaira(minor: string): string {
  return (Number(minor) / 100).toString();
}

export default function EditGadgetPage() {
  const { id } = useParams<{ id: string }>();
  const [initial, setInitial] = useState<ProductFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/gadgets/${id}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to load');
        const p: Product = data.product;
        setInitial({
          name: p.name,
          price: minorToNaira(p.priceMinor),
          compareAt: p.compareAtMinor ? minorToNaira(p.compareAtMinor) : '',
          category: p.category ?? '',
          description: p.description ?? '',
          imageUrl: p.imageUrl ?? '',
          stock: p.stock === null ? '' : String(p.stock),
          active: p.active,
          specs: Array.isArray(p.specs) ? p.specs : [],
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  return (
    <DashboardLayout>
      <div className="mb-6">
        <Link
          href="/gadgets"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={16} /> Back to catalog
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Edit product</h1>
        <p className="mt-2 text-gray-600">Update details, specifications, price, and stock.</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      ) : !initial ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-gray-400" />
        </div>
      ) : (
        <ProductForm mode="edit" productId={id} initial={initial} />
      )}
    </DashboardLayout>
  );
}
