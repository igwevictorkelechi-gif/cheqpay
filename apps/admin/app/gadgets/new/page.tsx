'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import ProductForm, { EMPTY_PRODUCT } from '@/components/ProductForm';

export default function NewGadgetPage() {
  return (
    <DashboardLayout>
      <div className="mb-6">
        <Link
          href="/gadgets"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={16} /> Back to catalog
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Add a product</h1>
        <p className="mt-2 text-gray-600">
          Choose a category to pull in the right specification fields, then fill in the details.
        </p>
      </div>

      <ProductForm mode="create" initial={EMPTY_PRODUCT} />
    </DashboardLayout>
  );
}
