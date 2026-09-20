"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/MobileUI";
import { api, ApiError, type GadgetOrder, type GadgetOrderStatus } from "@/services/api";

const STATUS_LABEL: Record<GadgetOrderStatus, string> = {
  PAID: "Order placed",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const STATUS_COLOR: Record<GadgetOrderStatus, string> = {
  PAID: "#6B5B95",
  PROCESSING: "#F5A623",
  SHIPPED: "#2E8BFF",
  DELIVERED: "#16A34A",
  CANCELLED: "#EF4444",
  REFUNDED: "#EF4444",
};

export default function GadgetOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<GadgetOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getGadgetOrders()
      .then(({ orders }) => setOrders(orders))
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Couldn't load your orders.");
        setOrders([]);
      });
  }, []);

  return (
    <AppShell>
      <div className="px-5 pt-4">
        <button
          onClick={() => router.push("/gadgets")}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>
      <h1 className="mb-5 mt-3 px-5 text-[32px] font-extrabold text-ink">My orders</h1>

      {orders === null ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : error ? (
        <div className="px-5">
          <Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card>
        </div>
      ) : orders.length === 0 ? (
        <div className="px-5">
          <Card>
            <div className="py-8 text-center">
              <Package className="mx-auto h-10 w-10 text-muted" />
              <p className="mt-3 text-sm text-muted">No orders yet.</p>
              <button
                onClick={() => router.push("/gadgets")}
                className="mt-4 rounded-full bg-brand px-8 py-3 text-sm font-bold text-white"
              >
                Browse gadgets
              </button>
            </div>
          </Card>
        </div>
      ) : (
        <div className="space-y-3 px-5 pb-10">
          {orders.map((o) => (
            <Card key={o.id}>
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink">
                    {o.quantity} × {o.productName}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {o.totalFormatted} · {new Date(o.createdAt).toLocaleDateString("en-NG")}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    To {o.delivery.address}, {o.delivery.city}
                  </p>
                </div>
                <span
                  className="ml-3 shrink-0 rounded-full px-3 py-1 text-xs font-bold text-white"
                  style={{ backgroundColor: STATUS_COLOR[o.status] }}
                >
                  {STATUS_LABEL[o.status]}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
