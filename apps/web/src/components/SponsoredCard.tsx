"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Info, X } from "lucide-react";
import { api, type AdPlacement, type ServedAd } from "@/services/api";
import { useFeatures } from "@/lib/useFeatures";

/**
 * Coarse location for ads — only if the person already allowed location for
 * this site (we never prompt from an ad). Rounded on the device; the server
 * rounds again to ~5 km and drops it entirely when "Personalised ads" is off.
 */
async function quietLocation(): Promise<{ lat: number; lng: number } | null> {
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

/** An advertiser's ad, clearly labelled, chosen for this person and this place in the app. */
export default function SponsoredCard({ placement, className = "" }: { placement: AdPlacement; className?: string }) {
  const features = useFeatures();
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [why, setWhy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(false);

  useEffect(() => {
    if (!features.ads) return;
    let live = true;
    (async () => {
      const loc = await quietLocation();
      const r = await api.serveAd(placement, loc ?? {}).catch(() => ({ ad: null }));
      if (live) setAd(r.ad);
    })();
    return () => {
      live = false;
    };
  }, [features.ads, placement]);

  // A view counts once the card has been at least half on screen for a second.
  useEffect(() => {
    if (!ad || !ref.current || seen.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          timer = setTimeout(() => {
            if (seen.current) return;
            seen.current = true;
            void api.adEvent(ad.campaignId, ad.channel, "view").catch(() => undefined);
          }, 1000);
        } else if (timer) clearTimeout(timer);
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(ref.current);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [ad]);

  if (!ad || hidden) return null;

  const open = () => {
    void api.adEvent(ad.campaignId, ad.channel, "click").catch(() => undefined);
    if (ad.linkUrl) window.open(ad.linkUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div ref={ref} className={`overflow-hidden rounded-3xl bg-card ${className}`} data-testid={`sponsored-${placement}`}>
      <div className="flex items-center justify-between px-4 pt-3 text-[11px] font-semibold text-muted">
        <span>
          Sponsored · <span className="text-ink">{ad.businessName}</span>
        </span>
        <span className="flex items-center gap-1">
          <button onClick={() => setWhy((w) => !w)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-circle" aria-label="Why am I seeing this ad?">
            <Info className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setHidden(true)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-circle" aria-label="Hide this ad">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {why && (
        <div className="mx-4 mt-2 rounded-2xl bg-circle px-3 py-2 text-xs text-muted">
          You&apos;re seeing this because: <span className="text-ink">{ad.why.join(" · ")}</span>.{" "}
          <Link href="/ad-preferences" className="font-semibold text-brand-light">Ad preferences</Link>
        </div>
      )}
      <button onClick={open} className="block w-full p-4 pt-3 text-left" disabled={!ad.linkUrl}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ad.image} alt="" className="aspect-[1.91/1] w-full rounded-2xl bg-circle object-cover" />
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-ink">{ad.headline}</p>
            {ad.body && <p className="mt-0.5 text-sm text-muted">{ad.body}</p>}
          </div>
          {ad.linkUrl && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand px-3.5 py-2 text-xs font-bold text-white">
              {ad.cta} <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </button>
    </div>
  );
}
