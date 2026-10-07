"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Clock, Loader2, LocateFixed, MapPin, Navigation, Star } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card, useToast } from "@/components/MobileUI";
import { allowedLocation, distanceLabel } from "@/components/NearbyStrip";
import { api, ApiError, type NearbyVenue } from "@/services/api";

/**
 * Partner places near you — gyms, restaurants, stores — nearest first, with
 * their current offers. Uses your rough location only if you allow it;
 * otherwise shows places in your state.
 */
export default function NearbyPage() {
  const router = useRouter();
  const toast = useToast();
  const [venues, setVenues] = useState<NearbyVenue[] | null>(null);
  const [basis, setBasis] = useState<"location" | "state" | "all">("all");
  const [categories, setCategories] = useState<{ key: string; label: string }[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loc = useRef<{ lat: number; lng: number } | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const load = useCallback(async (cat: string | null) => {
    try {
      const r = await api.nearbyVenues({ ...(loc.current ?? {}), category: cat });
      setVenues(r.venues);
      setBasis(r.basis);
      setCategories(r.categories);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load places near you.");
      setVenues([]);
    }
  }, []);

  useEffect(() => {
    setOpen(new URLSearchParams(window.location.search).get("venue"));
    (async () => {
      loc.current = await allowedLocation();
      await load(null);
    })();
  }, [load]);

  // Count each venue (and its offer) once when it's listed.
  useEffect(() => {
    for (const v of venues ?? []) {
      if (seen.current.has(v.id)) continue;
      seen.current.add(v.id);
      void api.venueEvent(v.id, "view", v.offer?.campaignId).catch(() => undefined);
    }
  }, [venues]);

  function locateMe() {
    if (!navigator.geolocation) return toast.show("Location isn't available on this device.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        loc.current = { lat: Math.round(p.coords.latitude * 100) / 100, lng: Math.round(p.coords.longitude * 100) / 100 };
        await load(category);
        setLocating(false);
      },
      () => {
        toast.show("Allow location to see the places closest to you.");
        setLocating(false);
      },
      { timeout: 8000, maximumAge: 30 * 60_000 },
    );
  }

  function pick(cat: string | null) {
    setCategory(cat);
    setVenues(null);
    void load(cat);
  }

  function expand(v: NearbyVenue) {
    setOpen(open === v.id ? null : v.id);
    if (open !== v.id) void api.venueEvent(v.id, "tap", v.offer?.campaignId).catch(() => undefined);
  }

  return (
    <AppShell>
      <div className="px-5 pt-4">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>
      <div className="px-5 pt-3">
        <h1 className="text-2xl font-extrabold text-ink">Places near you</h1>
        <p className="mt-1 text-sm text-muted">
          {basis === "location" ? "Nearest first, from your rough location." : basis === "state" ? "In your state." : "CheqPay partner places."}
        </p>
        {basis !== "location" && (
          <button onClick={locateMe} className="mt-3 flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold text-ink">
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4 text-brand-light" />} Use my location
          </button>
        )}
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
        <button onClick={() => pick(null)} className={`shrink-0 rounded-full border px-3.5 py-2 text-sm font-semibold ${!category ? "border-brand bg-brand/20 text-ink" : "border-border text-muted"}`}>All</button>
        {categories.map((c) => (
          <button key={c.key} onClick={() => pick(c.key)} className={`shrink-0 rounded-full border px-3.5 py-2 text-sm font-semibold ${category === c.key ? "border-brand bg-brand/20 text-ink" : "border-border text-muted"}`}>{c.label}</button>
        ))}
      </div>

      <div className="space-y-3 px-5 pb-32 pt-4">
        {!venues ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
        ) : venues.length === 0 ? (
          <Card><p className="py-8 text-center text-sm text-muted">{error ?? "No partner places here yet."}</p></Card>
        ) : (
          venues.map((v) => (
            <div key={v.id} className={`overflow-hidden rounded-3xl bg-card ${v.featured ? "ring-1 ring-amber-400/50" : ""}`}>
              <button onClick={() => expand(v)} className="flex w-full gap-3 p-3 text-left">
                {v.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.photo} alt="" className="h-20 w-24 shrink-0 rounded-2xl object-cover" />
                ) : (
                  <span className="flex h-20 w-24 shrink-0 items-center justify-center rounded-2xl bg-circle"><MapPin className="h-6 w-6 text-muted" /></span>
                )}
                <span className="min-w-0 flex-1">
                  {v.featured && <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-400"><Star className="h-3 w-3 fill-amber-400" /> Featured</span>}
                  <span className="block truncate font-bold text-ink">{v.name}</span>
                  <span className="block truncate text-xs text-muted">{[v.categoryLabel, distanceLabel(v.distanceKm), v.city].filter(Boolean).join(" · ")}</span>
                  <span className="mt-1 flex items-center gap-1 text-xs">
                    <Clock className="h-3 w-3 text-muted" />
                    {v.openNow === null ? <span className="text-muted">Hours not listed</span> : v.openNow ? <span className="font-semibold text-green-400">Open now</span> : <span className="font-semibold text-red-400">Closed</span>}
                    {v.hours && <span className="text-muted">· {v.hours}</span>}
                  </span>
                  {v.offer && !(open === v.id) && <span className="mt-1 block truncate text-xs font-semibold text-amber-400">{v.offer.headline}</span>}
                </span>
              </button>
              {open === v.id && (
                <div className="space-y-3 border-t border-border p-4">
                  {v.description && <p className="text-sm text-muted">{v.description}</p>}
                  {v.address && <p className="flex items-start gap-2 text-sm text-ink"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" />{v.address}{v.city ? `, ${v.city}` : ""}</p>}
                  {v.offer && (
                    <div className="overflow-hidden rounded-2xl bg-circle">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.offer.image} alt="" className="aspect-[1.91/1] w-full object-cover" />
                      <div className="p-3">
                        <p className="text-[11px] font-semibold text-muted">Offer from {v.name}</p>
                        <p className="font-bold text-ink">{v.offer.headline}</p>
                        {v.offer.body && <p className="text-sm text-muted">{v.offer.body}</p>}
                        {v.offer.linkUrl && (
                          <a href={v.offer.linkUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand px-3.5 py-2 text-xs font-bold text-white">
                            {v.offer.cta} <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {v.mapsUrl && (
                    <a href={v.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand to-brand-light py-3 text-sm font-bold text-white">
                      <Navigation className="h-4 w-4" /> Directions
                    </a>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
