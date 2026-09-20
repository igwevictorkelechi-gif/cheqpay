'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShoppingBag } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type Status = 'PAID' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';

interface Order {
  id: string;
  userId: string;
  userEmail: string | null;
  productName: string;
  quantity: number;
  totalFormatted: string;
  status: Status;
  delivery: { name: string; phone: string; address: string; city: string; state: string };
  note: string | null;
  createdAt: string;
}

const STATUS_STYLE: Record<Status, string> = {
  PAID: 'bg-purple-100 text-purple-700',
  PROCESSING: 'bg-amber-100 text-amber-700',
  SHIPPED: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-red-100 text-red-700',
};

// What an order can move to next. Refund states return money (see the API).
const NEXT: Record<Status, Status[]> = {
  PAID: ['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'DELIVERED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export default function GadgetOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/gadgets/orders', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setOrders(data.orders);
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function setStatus(order: Order, status: Status) {
    const moneyBack = status === 'CANCELLED' || status === 'REFUNDED';
    if (moneyBack && !confirm(`This refunds ${order.totalFormatted} to the customer. Continue?`)) {
      return;
    }
    setBusy(order.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/gadgets/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not update the order');
      setMessage({ kind: 'ok', text: `Order marked ${status.toLowerCase()}.` });
      await load();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not update' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Gadget Orders</h1>
        <p className="mt-2 text-gray-600">
          The fulfilment queue. Advance an order as you ship it; cancel or refund returns the money.
        </p>
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

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          <ShoppingBag className="mx-auto mb-3 text-gray-300" size={40} />
          No orders yet.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">
                    {o.quantity} × {o.productName} · {o.totalFormatted}
                  </div>
                  <div className="mt-0.5 text-sm text-gray-600">
                    {o.userEmail ?? o.userId} · {new Date(o.createdAt).toLocaleString('en-NG')}
                  </div>
                  <div className="mt-2 text-sm text-gray-700">
                    <span className="font-medium">{o.delivery.name}</span> · {o.delivery.phone}
                    <br />
                    {o.delivery.address}, {o.delivery.city}, {o.delivery.state}
                  </div>
                  {o.note ? <div className="mt-1 text-sm italic text-gray-500">“{o.note}”</div> : null}
                </div>
                <span className={'rounded-full px-3 py-1 text-xs font-semibold ' + STATUS_STYLE[o.status]}>
                  {o.status}
                </span>
              </div>

              {NEXT[o.status].length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                  {NEXT[o.status].map((s) => {
                    const moneyBack = s === 'CANCELLED' || s === 'REFUNDED';
                    return (
                      <button
                        key={s}
                        disabled={busy === o.id}
                        onClick={() => setStatus(o, s)}
                        className={
                          'rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ' +
                          (moneyBack
                            ? 'border border-red-300 text-red-700 hover:bg-red-50'
                            : 'bg-brand-600 text-white hover:bg-brand-700')
                        }
                      >
                        {busy === o.id && <Loader2 size={12} className="mr-1 inline animate-spin" />}
                        {s === 'CANCELLED' ? 'Cancel & refund' : `Mark ${s.toLowerCase()}`}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
