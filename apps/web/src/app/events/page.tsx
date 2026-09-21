"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CalendarDays, Ticket, MapPin } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/MobileUI";
import { api, ApiError, type EventItem } from "@/services/api";

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function EventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [comingSoon, setComingSoon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getEvents()
      .then(({ events }) => setEvents(events))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 503) {
          setComingSoon(true);
          setEvents([]);
        } else {
          setError(e instanceof ApiError ? e.message : "Couldn't load events.");
          setEvents([]);
        }
      });
  }, []);

  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-4">
        <button onClick={() => router.push("/pay-bill")} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button onClick={() => router.push("/events/tickets")} className="flex items-center gap-1.5 text-sm font-semibold text-brand">
          <Ticket className="h-4 w-4" /> My tickets
        </button>
      </div>

      <h1 className="mb-1 mt-3 px-5 text-2xl font-extrabold text-ink">Events</h1>
      <p className="mb-5 px-5 text-sm text-muted">Concerts, shows and more — pay from your balance.</p>

      {events === null ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : comingSoon ? (
        <div className="px-5"><Card><div className="py-8 text-center"><span className="text-4xl">🎫</span><p className="mt-3 text-lg font-bold text-ink">Coming soon</p><p className="mt-1 text-sm text-muted">Events are almost ready. Check back shortly.</p></div></Card></div>
      ) : error ? (
        <div className="px-5"><Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card></div>
      ) : events.length === 0 ? (
        <div className="px-5"><Card><p className="py-8 text-center text-sm text-muted">No events listed yet. Please check back soon.</p></Card></div>
      ) : (
        <div className="space-y-3 px-5 pb-10">
          {events.map((ev) => (
            <button key={ev.id} onClick={() => router.push(`/events/${ev.id}`)}
              className="flex w-full overflow-hidden rounded-2xl bg-card text-left transition active:scale-[0.99]">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center bg-circle">
                {ev.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ev.imageUrl} alt={ev.title} className="h-full w-full object-cover" />
                ) : (
                  <CalendarDays className="h-8 w-8 text-muted" />
                )}
              </div>
              <div className="min-w-0 flex-1 p-3">
                <p className="line-clamp-2 text-sm font-bold text-ink">{ev.title}</p>
                {whenLabel(ev.startsAt) ? <p className="mt-1 text-xs text-muted">{whenLabel(ev.startsAt)}</p> : null}
                {ev.venue || ev.city ? (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                    <MapPin className="h-3 w-3" /> {[ev.venue, ev.city].filter(Boolean).join(", ")}
                  </p>
                ) : null}
                <p className="mt-1 text-sm font-extrabold text-brand">
                  {ev.fromPriceFormatted ? `From ${ev.fromPriceFormatted}` : "Sold out"}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </AppShell>
  );
}
