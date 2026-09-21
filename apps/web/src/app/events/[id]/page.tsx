"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CalendarDays, MapPin, Ticket, Check } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card, useToast } from "@/components/MobileUI";
import { api, ApiError, type EventItem, type EventTier } from "@/services/api";
import { useTransactionPin, PIN_CANCELLED } from "@/components/TransactionPinProvider";

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-NG", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { authorize } = useTransactionPin();

  const [event, setEvent] = useState<EventItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.getEvent(id)
      .then(({ event }) => {
        setEvent(event);
        const first = event.tiers.find((t) => t.available);
        setTierId(first ? first.id : null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this event."));
  }, [id]);

  const tier: EventTier | undefined = event?.tiers.find((t) => t.id === tierId);
  const maxQty = Math.min(10, tier?.remaining ?? 10);
  const canPay = !!tier && tier.available && qty >= 1 && !busy;

  async function pay() {
    if (!event || !tier) return;
    setBusy(true);
    try {
      await authorize(
        (pin) => api.buyTickets({ eventId: event.id, tierId: tier.id, quantity: qty }, pin),
        { title: "Confirm this purchase", detail: `${qty} × ${tier.name} — ${tier.priceFormatted} each.` },
      );
      setDone(true);
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) { setBusy(false); return; }
      toast.show(e instanceof ApiError ? e.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done && event) {
    return (
      <AppShell>
        <div className="flex min-h-[70vh] flex-col items-center justify-center px-8 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand/15">
            <Check className="h-10 w-10 text-brand" />
          </span>
          <h1 className="mt-6 text-2xl font-extrabold text-ink">You&apos;re going!</h1>
          <p className="mt-2 text-sm text-muted">
            {qty} × {tier?.name} for {event.title} confirmed. Your ticket{qty > 1 ? "s are" : " is"} in My tickets.
          </p>
          <button onClick={() => router.push("/events/tickets")} className="mt-8 rounded-full bg-brand px-10 py-3.5 text-base font-bold text-white">
            View my tickets
          </button>
          <button onClick={() => router.push("/events")} className="mt-3 text-sm font-semibold text-muted">Back to events</button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-5 pt-4">
        <button onClick={() => router.push("/events")} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      {error ? (
        <div className="px-5 pt-4"><Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card></div>
      ) : !event ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : (
        <div className="px-5 pb-10">
          {event.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.imageUrl} alt={event.title} className="mt-4 h-48 w-full rounded-2xl object-cover" />
          ) : (
            <div className="mt-4 flex h-40 w-full items-center justify-center rounded-2xl bg-circle"><CalendarDays className="h-10 w-10 text-muted" /></div>
          )}

          <h1 className="mt-4 text-2xl font-extrabold text-ink">{event.title}</h1>
          {whenLabel(event.startsAt) ? <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><CalendarDays className="h-4 w-4" /> {whenLabel(event.startsAt)}</p> : null}
          {event.venue || event.city ? <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><MapPin className="h-4 w-4" /> {[event.venue, event.city].filter(Boolean).join(", ")}</p> : null}
          {event.description ? <p className="mt-3 text-sm leading-relaxed text-muted">{event.description}</p> : null}

          {/* Tiers */}
          <h2 className="mt-6 text-lg font-bold text-ink">Choose a ticket</h2>
          <div className="mt-3 space-y-2">
            {event.tiers.length === 0 && <p className="text-sm text-muted">No tickets available.</p>}
            {event.tiers.map((t) => {
              const selected = t.id === tierId;
              return (
                <button
                  key={t.id}
                  disabled={!t.available}
                  onClick={() => { setTierId(t.id); setQty(1); }}
                  className={
                    "flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition disabled:opacity-50 " +
                    (selected ? "border-brand bg-brand/10" : "border-border bg-card")
                  }
                >
                  <div>
                    <p className="font-bold text-ink">{t.name}</p>
                    <p className="text-sm text-muted">
                      {t.available ? (t.remaining !== null ? `${t.remaining} left` : "Available") : "Sold out"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-brand">{t.priceFormatted}</span>
                    {selected ? <Check className="h-5 w-5 text-brand" /> : <Ticket className="h-5 w-5 text-muted" />}
                  </div>
                </button>
              );
            })}
          </div>

          {tier && tier.available ? (
            <>
              <div className="mt-6 flex items-center justify-between">
                <span className="text-base font-semibold text-ink">Quantity</span>
                <div className="flex items-center gap-4">
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-xl font-bold text-ink" aria-label="Decrease">−</button>
                  <span className="w-6 text-center text-lg font-bold text-ink">{qty}</span>
                  <button onClick={() => setQty((q) => Math.min(maxQty, q + 1))} className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-xl font-bold text-ink" aria-label="Increase">+</button>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between rounded-2xl bg-card px-4 py-4">
                <span className="text-sm text-muted">Total</span>
                <span className="text-xl font-extrabold text-ink">
                  ₦{((Number(tier.priceMinor) * qty) / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}
                </span>
              </div>

              <button onClick={pay} disabled={!canPay}
                className="mt-5 mb-4 flex w-full items-center justify-center gap-2 rounded-full bg-brand py-4 text-base font-bold text-white disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? "Booking…" : "Pay & get tickets"}
              </button>
            </>
          ) : null}
        </div>
      )}
      {toast.node}
    </AppShell>
  );
}
