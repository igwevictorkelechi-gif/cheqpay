"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Package, ShoppingBag } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card, useToast } from "@/components/MobileUI";
import { api, ApiError, type GadgetProduct, type GadgetDelivery } from "@/services/api";
import { useTransactionPin, PIN_CANCELLED } from "@/components/TransactionPinProvider";

type Step = "browse" | "buy" | "done";

const EMPTY_DELIVERY: GadgetDelivery = {
  name: "",
  phone: "",
  address: "",
  city: "",
  state: "",
};

export default function GadgetsPage() {
  const router = useRouter();
  const toast = useToast();
  const { authorize } = useTransactionPin();

  const [products, setProducts] = useState<GadgetProduct[] | null>(null);
  const [comingSoon, setComingSoon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("browse");
  const [category, setCategory] = useState<string>("");
  const [selected, setSelected] = useState<GadgetProduct | null>(null);
  const [qty, setQty] = useState(1);
  const [delivery, setDelivery] = useState<GadgetDelivery>(EMPTY_DELIVERY);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getGadgets()
      .then(({ products }) => setProducts(products))
      .catch((e) => {
        // 503 = the store is switched off (no catalog / not launched yet).
        if (e instanceof ApiError && e.status === 503) {
          setComingSoon(true);
          setProducts([]);
        } else {
          setError(e instanceof ApiError ? e.message : "Couldn't load the store.");
          setProducts([]);
        }
      });
  }, []);

  function openBuy(p: GadgetProduct) {
    setSelected(p);
    setQty(1);
    setDelivery(EMPTY_DELIVERY);
    setNote("");
    setStep("buy");
  }

  const deliveryComplete = Object.values(delivery).every((v) => v.trim().length > 0);
  const canPay = selected !== null && qty >= 1 && deliveryComplete && !busy;

  async function pay() {
    if (!selected) return;
    setBusy(true);
    try {
      await authorize(
        (pin) =>
          api.buyGadget(
            { productId: selected.id, quantity: qty, delivery, note: note.trim() || undefined },
            pin,
          ),
        {
          title: "Confirm this order",
          detail: `${qty} × ${selected.name} — ${selected.priceFormatted} each.`,
        },
      );
      setStep("done");
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) {
        setBusy(false);
        return;
      }
      toast.show(e instanceof ApiError ? e.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand";

  // Category chips for the browse view, derived from what's actually in stock.
  const categories = Array.from(
    new Set((products ?? []).map((p) => p.category).filter(Boolean)),
  ).sort();
  const visibleProducts = (products ?? []).filter(
    (p) => !category || p.category === category,
  );

  // ---- Success ----
  if (step === "done" && selected) {
    return (
      <AppShell>
        <div className="flex min-h-[70vh] flex-col items-center justify-center px-8 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand/15">
            <Package className="h-10 w-10 text-brand" />
          </span>
          <h1 className="mt-6 text-2xl font-extrabold text-ink">Order placed</h1>
          <p className="mt-2 text-sm text-muted">
            Your order for {qty} × {selected.name} is confirmed. We&apos;ll be in touch about delivery.
          </p>
          <button
            onClick={() => router.push("/gadgets/orders")}
            className="mt-8 rounded-full bg-brand px-10 py-3.5 text-base font-bold text-white"
          >
            View my orders
          </button>
          <button
            onClick={() => setStep("browse")}
            className="mt-3 text-sm font-semibold text-muted"
          >
            Keep shopping
          </button>
        </div>
      </AppShell>
    );
  }

  // ---- Buy flow ----
  if (step === "buy" && selected) {
    return (
      <AppShell>
        <div className="px-5 pt-4">
          <button
            onClick={() => setStep("browse")}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="mt-4">
            {selected.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.imageUrl}
                alt={selected.name}
                className="mb-4 h-48 w-full rounded-2xl object-cover"
              />
            ) : null}
            <h1 className="text-2xl font-extrabold text-ink">{selected.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-brand">{selected.priceFormatted}</span>
              {selected.compareAtFormatted ? (
                <span className="text-sm text-muted line-through">{selected.compareAtFormatted}</span>
              ) : null}
              {selected.discountPercent ? (
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">
                  Save {selected.discountPercent}%
                </span>
              ) : null}
            </div>
            {selected.description ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">{selected.description}</p>
            ) : null}
          </div>

          {/* Specifications */}
          {selected.specs && selected.specs.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-lg font-bold text-ink">Specifications</h2>
              <dl className="mt-3 overflow-hidden rounded-2xl border border-border">
                {selected.specs.map((s, i) => (
                  <div
                    key={i}
                    className={
                      "flex justify-between gap-4 px-4 py-3 text-sm " +
                      (i % 2 === 0 ? "bg-card" : "bg-transparent")
                    }
                  >
                    <dt className="text-muted">{s.label}</dt>
                    <dd className="text-right font-semibold text-ink">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* Quantity */}
          <div className="mt-6 flex items-center justify-between">
            <span className="text-base font-semibold text-ink">Quantity</span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-xl font-bold text-ink"
                aria-label="Decrease"
              >
                −
              </button>
              <span className="w-6 text-center text-lg font-bold text-ink">{qty}</span>
              <button
                onClick={() => setQty((q) => Math.min(20, q + 1))}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-xl font-bold text-ink"
                aria-label="Increase"
              >
                +
              </button>
            </div>
          </div>

          {/* Delivery */}
          <h2 className="mt-7 text-lg font-bold text-ink">Delivery details</h2>
          <div className="mt-3 space-y-3">
            <input className={inputCls} placeholder="Full name" value={delivery.name}
              onChange={(e) => setDelivery((d) => ({ ...d, name: e.target.value }))} />
            <input className={inputCls} placeholder="Phone number" inputMode="tel" value={delivery.phone}
              onChange={(e) => setDelivery((d) => ({ ...d, phone: e.target.value }))} />
            <input className={inputCls} placeholder="Street address" value={delivery.address}
              onChange={(e) => setDelivery((d) => ({ ...d, address: e.target.value }))} />
            <div className="flex gap-3">
              <input className={inputCls} placeholder="City" value={delivery.city}
                onChange={(e) => setDelivery((d) => ({ ...d, city: e.target.value }))} />
              <input className={inputCls} placeholder="State" value={delivery.state}
                onChange={(e) => setDelivery((d) => ({ ...d, state: e.target.value }))} />
            </div>
            <input className={inputCls} placeholder="Note for delivery (optional)" value={note}
              onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="mt-6 flex items-center justify-between rounded-2xl bg-card px-4 py-4">
            <span className="text-sm text-muted">Total</span>
            <span className="text-xl font-extrabold text-ink">
              ₦{((Number(selected.priceMinor) * qty) / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}
            </span>
          </div>

          <button
            onClick={pay}
            disabled={!canPay}
            className="mt-5 mb-10 flex w-full items-center justify-center gap-2 rounded-full bg-brand py-4 text-base font-bold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Placing order…" : "Pay & order"}
          </button>
        </div>
        {toast.node}
      </AppShell>
    );
  }

  // ---- Browse ----
  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-4">
        <button
          onClick={() => router.push("/pay-bill")}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          onClick={() => router.push("/gadgets/orders")}
          className="flex items-center gap-1.5 text-sm font-semibold text-brand"
        >
          <ShoppingBag className="h-4 w-4" /> My orders
        </button>
      </div>

      <h1 className="mb-1 mt-3 px-5 text-[32px] font-extrabold text-ink">Gadgets</h1>
      <p className="mb-4 px-5 text-sm text-muted">Buy from CheqPay, delivered to you.</p>

      {categories.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            onClick={() => setCategory("")}
            className={
              "shrink-0 rounded-full px-4 py-2 text-sm font-semibold " +
              (category === "" ? "bg-brand text-white" : "bg-card text-muted")
            }
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={
                "shrink-0 rounded-full px-4 py-2 text-sm font-semibold " +
                (category === c ? "bg-brand text-white" : "bg-card text-muted")
              }
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {products === null ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : comingSoon ? (
        <div className="px-5">
          <Card>
            <div className="py-8 text-center">
              <span className="text-4xl">🛍️</span>
              <p className="mt-3 text-lg font-bold text-ink">Coming soon</p>
              <p className="mt-1 text-sm text-muted">
                The gadget store is almost ready. Check back shortly.
              </p>
            </div>
          </Card>
        </div>
      ) : error ? (
        <div className="px-5">
          <Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card>
        </div>
      ) : products.length === 0 ? (
        <div className="px-5">
          <Card>
            <p className="py-8 text-center text-sm text-muted">
              No gadgets are listed yet. Please check back soon.
            </p>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-5 pb-10">
          {visibleProducts.map((p) => (
            <button
              key={p.id}
              onClick={() => p.available && openBuy(p)}
              disabled={!p.available}
              className="flex flex-col overflow-hidden rounded-2xl bg-card text-left transition active:scale-95 disabled:opacity-60"
            >
              <div className="flex h-32 w-full items-center justify-center bg-circle">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <Package className="h-10 w-10 text-muted" />
                )}
              </div>
              <div className="p-3">
                <p className="line-clamp-2 text-sm font-bold text-ink">{p.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-sm font-extrabold text-brand">{p.priceFormatted}</span>
                  {p.compareAtFormatted ? (
                    <span className="text-xs text-muted line-through">{p.compareAtFormatted}</span>
                  ) : null}
                </div>
                {p.discountPercent ? (
                  <span className="mt-1 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">
                    Save {p.discountPercent}%
                  </span>
                ) : null}
                {!p.available ? (
                  <p className="mt-1 text-xs font-semibold text-muted">Sold out</p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
      {toast.node}
    </AppShell>
  );
}
