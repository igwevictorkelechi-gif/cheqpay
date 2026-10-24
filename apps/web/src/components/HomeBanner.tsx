"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type HomeBannerData } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";
import { safeHttpsUrl, safeInternalPath } from "@/lib/safeUrl";

const CACHE_KEY = "cheqpay:home:banners";
/** How long each banner shows before the next slides in. */
const ROTATE_MS = 5000;
/** After a swipe or tap, how long to leave the user in charge. */
const HOLD_AFTER_TOUCH_MS = 8000;

/**
 * The admin's live home banners, in order (empty when none). The last list is
 * kept so a returning user sees them straight away instead of a flash of the
 * Cash card.
 */
export function useHomeBanners(): HomeBannerData[] {
  const [banners, setBanners] = useState<HomeBannerData[]>([]);
  useEffect(() => {
    let active = true;
    setBanners(readCache<HomeBannerData[]>(CACHE_KEY) ?? []);
    api
      .getHomeBanners()
      .then(({ banners, banner }) => {
        if (!active) return;
        // An API from before the carousel sends just `banner`.
        const list = banners ?? (banner ? [banner] : []);
        setBanners(list);
        writeCache(CACHE_KEY, list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return banners;
}

/** One banner, filling the slot. */
function Slide({ banner }: { banner: HomeBannerData }) {
  const router = useRouter();
  const internal = safeInternalPath(banner.linkUrl);
  const external = internal ? null : safeHttpsUrl(banner.linkUrl);
  const hasText = Boolean(banner.title || banner.message);

  const open = () => {
    if (internal) router.push(internal);
    else if (external) window.open(external, "_blank", "noopener,noreferrer");
  };

  const body = (
    <>
      {banner.imageUrl && (
        // A background rather than an <img>: browsers offer "Save image" and
        // drag-out for an <img>, and the banners aren't meant to be taken.
        <div
          role={banner.title ? "img" : undefined}
          aria-label={banner.title ?? undefined}
          aria-hidden={banner.title ? undefined : true}
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${JSON.stringify(banner.imageUrl)})` }}
        />
      )}
      {hasText && (
        <div
          className="absolute inset-0 flex flex-col justify-center px-5 text-left"
          style={{ background: banner.imageUrl ? "linear-gradient(90deg,rgba(0,0,0,0.65),rgba(0,0,0,0.1))" : undefined }}
        >
          {banner.title && <p className="line-clamp-1 text-base font-bold text-white">{banner.title}</p>}
          {banner.message && <p className="mt-1 line-clamp-2 max-w-[85%] text-sm text-white/85">{banner.message}</p>}
        </div>
      )}
    </>
  );

  const cls = "relative block h-full w-full shrink-0 snap-center overflow-hidden bg-gradient-to-r from-brand to-brand-light";
  return internal || external ? (
    <button type="button" onClick={open} className={cls} aria-label={banner.title ?? "Open banner"}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * The banners in the home screen's card slot, exactly the height of the Cash
 * card they replace so nothing below moves: h-32 is 8rem, the card's padding
 * (2.5rem), label (1.5rem), gap (1rem) and row (3rem) added up.
 *
 * With more than one, they slide by every few seconds and can be swiped; the
 * dots show which is showing. A touch hands control to the user for a while,
 * and nothing moves on its own for people who ask for reduced motion.
 */
export default function HomeBannerCarousel({ banners }: { banners: HomeBannerData[] }) {
  const track = useRef<HTMLDivElement>(null);
  const holdUntil = useRef(0);
  const [index, setIndex] = useState(0);
  const many = banners.length > 1;

  const goTo = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  useEffect(() => {
    if (!many || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      const el = track.current;
      if (!el || Date.now() < holdUntil.current || document.hidden) return;
      const current = Math.round(el.scrollLeft / el.clientWidth);
      goTo((current + 1) % banners.length);
    }, ROTATE_MS);
    return () => window.clearInterval(t);
  }, [many, banners.length]);

  const hold = () => {
    holdUntil.current = Date.now() + HOLD_AFTER_TOUCH_MS;
  };

  return (
    <div
      className="no-save relative h-32 overflow-hidden rounded-3xl"
      aria-roledescription={many ? "carousel" : undefined}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={track}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        onPointerDown={hold}
        onTouchStart={hold}
        onWheel={hold}
        className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto"
      >
        {banners.map((b) => (
          <Slide key={b.id} banner={b} />
        ))}
      </div>
      {many && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              aria-label={`Show banner ${i + 1} of ${banners.length}`}
              aria-current={i === index}
              onClick={() => {
                hold();
                goTo(i);
              }}
              className={`pointer-events-auto h-1.5 rounded-full shadow-[0_0_2px_rgba(0,0,0,0.6)] transition-all ${
                i === index ? "w-4 bg-white" : "w-1.5 bg-white/60"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
