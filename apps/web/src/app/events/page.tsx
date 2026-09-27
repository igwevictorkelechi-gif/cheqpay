"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CalendarDays, Ticket, MapPin, Search, Share2, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card, useToast } from "@/components/MobileUI";
import { api, ApiError, type EventItem } from "@/services/api";
import { shareEvent } from "@/lib/eventShare";

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A row of tappable filter chips; tapping the selected chip clears it. */
function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="mb-1.5 px-5 text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]" role="group" aria-label={label}>
        {["", ...options].map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt || "all"}
              onClick={() => onChange(opt)}
              aria-pressed={active}
              className={
                "min-h-[36px] shrink-0 rounded-full px-4 text-sm font-semibold transition " +
                (active ? "bg-brand text-white" : "bg-card text-ink")
              }
            >
              {opt || "All"}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function EventsPage() {
  const router = useRouter();
  const toast = useToast();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [comingSoon, setComingSoon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [hasFree, setHasFree] = useState(false);
  const [cities, setCities] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  // Search as the person types (after a short pause) and whenever a filter
  // changes. Only the latest request's answer is shown.
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    const t = setTimeout(
      () => {
        api
          .getEvents({ q: query, city, category, free: freeOnly })
          .then((r) => {
            if (id !== requestId.current) return;
            setEvents(Array.isArray(r?.events) ? r.events : []);
            if (r?.filters) {
              setCities(Array.isArray(r.filters.cities) ? r.filters.cities : []);
              setCategories(Array.isArray(r.filters.categories) ? r.filters.categories : []);
              setHasFree(!!r.filters.hasFree);
            }
            setError(null);
          })
          .catch((e) => {
            if (id !== requestId.current) return;
            if (e instanceof ApiError && e.status === 503) {
              setComingSoon(true);
            } else {
              setError(e instanceof ApiError ? e.message : "Couldn't load events.");
            }
            setEvents([]);
          })
          .finally(() => {
            if (id === requestId.current) setLoading(false);
          });
      },
      query ? 300 : 0,
    );
    return () => clearTimeout(t);
  }, [query, city, category, freeOnly]);

  const filtering = !!(query.trim() || city || category || freeOnly);

  const share = async (ev: EventItem) => {
    const result = await shareEvent(ev);
    if (result === "copied") toast.show("Event link copied — paste it to share.");
    else if (result === "failed") toast.show("Couldn't share this event. Try again.");
  };

  return (
    <AppShell>
      {toast.node}
      <div className="flex items-center justify-between px-5 pt-4">
        <button onClick={() => router.push("/pay-bill")} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button onClick={() => router.push("/events/tickets")} className="flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-brand">
          <Ticket className="h-4 w-4" /> My tickets
        </button>
      </div>

      <h1 className="mb-1 mt-3 px-5 text-2xl font-extrabold text-ink">Events</h1>
      <p className="mb-4 px-5 text-sm text-muted">Concerts, shows and more — pay from your balance.</p>

      {!comingSoon && (
        <>
          <div className="mb-4 px-5">
            <label className="flex items-center gap-2 rounded-2xl bg-card px-4">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input
                id="event-search"
                type="search"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search events, venues or cities"
                aria-label="Search events"
                className="min-h-[48px] w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
              />
              {query ? (
                <button onClick={() => setQuery("")} aria-label="Clear search" className="flex h-9 w-9 items-center justify-center text-muted">
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
          </div>
          {hasFree || freeOnly ? (
            <Chips label="Price" options={["Free"]} value={freeOnly ? "Free" : ""} onChange={(v) => setFreeOnly(v === "Free")} />
          ) : null}
          <Chips label="Location" options={cities} value={city} onChange={setCity} />
          <Chips label="Category" options={categories} value={category} onChange={setCategory} />
        </>
      )}

      {events === null ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : comingSoon ? (
        <div className="px-5"><Card><div className="py-8 text-center"><span className="text-4xl">🎫</span><p className="mt-3 text-lg font-bold text-ink">Coming soon</p><p className="mt-1 text-sm text-muted">Events are almost ready. Check back shortly.</p></div></Card></div>
      ) : error ? (
        <div className="px-5"><Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card></div>
      ) : events.length === 0 ? (
        <div className="px-5">
          <Card>
            <div className="py-8 text-center">
              <p className="text-sm text-muted">
                {filtering ? "No events match your search." : "No events listed yet. Please check back soon."}
              </p>
              {filtering ? (
                <button
                  onClick={() => { setQuery(""); setCity(""); setCategory(""); setFreeOnly(false); }}
                  className="mt-4 rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-white"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </Card>
        </div>
      ) : (
        <div className={"space-y-3 px-5 pb-10 transition-opacity " + (loading ? "opacity-60" : "")}>
          {events.map((ev) => (
            <div key={ev.id} className="relative flex overflow-hidden rounded-2xl bg-card">
              <button
                onClick={() => router.push(`/events/view?id=${ev.id}`)}
                className="flex min-w-0 flex-1 text-left transition active:scale-[0.99]"
              >
                <div className="flex h-24 w-24 shrink-0 items-center justify-center bg-circle">
                  {ev.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ev.imageUrl} alt={ev.title} className="h-full w-full object-cover" />
                  ) : (
                    <CalendarDays className="h-8 w-8 text-muted" />
                  )}
                </div>
                <div className="min-w-0 flex-1 p-3 pr-12">
                  {ev.category || ev.free ? (
                    <div className="mb-1 flex flex-wrap gap-1">
                      {ev.free ? (
                        <span className="inline-block rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">Free</span>
                      ) : null}
                      {ev.category ? (
                        <span className="inline-block rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">{ev.category}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="line-clamp-2 text-sm font-bold text-ink">{ev.title}</p>
                  {whenLabel(ev.startsAt) ? <p className="mt-1 text-xs text-muted">{whenLabel(ev.startsAt)}</p> : null}
                  {ev.venue || ev.city ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                      <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{[ev.venue, ev.city].filter(Boolean).join(", ")}</span>
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm font-extrabold text-brand">
                    {!ev.fromPriceFormatted ? "Sold out" : ev.fromPriceFormatted === "Free" ? "Free" : `From ${ev.fromPriceFormatted}`}
                  </p>
                </div>
              </button>
              <button
                onClick={() => void share(ev)}
                aria-label={`Share ${ev.title}`}
                title="Share event"
                className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full text-ink active:opacity-70"
              >
                <Share2 className="h-5 w-5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
