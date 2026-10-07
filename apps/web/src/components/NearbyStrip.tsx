"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, MapPin, Star } from "lucide-react";
import { api, type NearbyVenue } from "@/services/api";
import { useFeatures } from "@/lib/useFeatures";

/** Rough location, only if already allowed for this site — never prompts from the home screen. */
export async function allowedLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!navigator.geolocation || !navigator.permissions) return null;
    const p = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (p.state !== "granted") return null;
    return await new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100 }),
        () => resolve(null),
        { maximumAge: 30 * 60_000, timeout: 4000, enableHighAccuracy: false },
      ),
    );
  } catch {
    return null;
  }
}

export const distanceLabel = (km: number | null) => (km === null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);

/** "Places near you" on the home screen: the three nearest partner venues. */
export default function NearbyStrip() {
  const features = useFeatures();
  const [venues, setVenues] = useState<NearbyVenue[] | null>(null);

  useEffect(() => {
    if (!features.ads) return;
    let live = true;
    (async () => {
      const loc = await allowedLocation();
      const r = await api.nearbyVenues(loc ?? {}).catch(() => null);
      if (live) setVenues(r?.venues.slice(0, 3) ?? []);
    })();
    return () => {
      live = false;
    };
  }, [features.ads]);

  if (!venues?.length) return null;
  return (
    <div className="mb-5 px-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-base font-bold text-ink">Places near you</p>
        <Link href="/nearby" className="flex items-center text-sm font-semibold text-brand-light">See all <ChevronRight className="h-4 w-4" /></Link>
      </div>
      <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
        {venues.map((v) => (
          <Link key={v.id} href={`/nearby?venue=${v.id}`} className="w-48 shrink-0 overflow-hidden rounded-3xl bg-card">
            {v.photo || v.offer?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.offer?.image ?? v.photo!} alt="" className="h-24 w-full object-cover" />
            ) : (
              <div className="flex h-24 w-full items-center justify-center bg-circle"><MapPin className="h-6 w-6 text-muted" /></div>
            )}
            <div className="p-3">
              <p className="flex items-center gap-1 truncate text-sm font-bold text-ink">
                {v.featured && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                {v.name}
              </p>
              <p className="truncate text-xs text-muted">{[v.categoryLabel, distanceLabel(v.distanceKm) ?? v.city].filter(Boolean).join(" · ")}</p>
              {v.offer && <p className="mt-1 truncate text-xs font-semibold text-amber-400">{v.offer.headline}</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
