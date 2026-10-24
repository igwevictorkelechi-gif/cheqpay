"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type HomeBannerData } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";
import { safeHttpsUrl, safeInternalPath } from "@/lib/safeUrl";

const CACHE_KEY = "cheqpay:home:banner";

/**
 * The admin's home banner, or null when none is live. The last one is kept so
 * a returning user sees it straight away instead of a flash of the Cash card.
 */
export function useHomeBanner(): HomeBannerData | null {
  const [banner, setBanner] = useState<HomeBannerData | null>(null);
  useEffect(() => {
    let active = true;
    setBanner(readCache<HomeBannerData>(CACHE_KEY));
    api
      .getHomeBanner()
      .then(({ banner }) => {
        if (!active) return;
        setBanner(banner);
        writeCache(CACHE_KEY, banner);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return banner;
}

/**
 * The banner in the home screen's card slot, exactly the height of the Cash
 * card it replaces so nothing below it moves: h-32 is 8rem, the card's padding
 * (2.5rem), label (1.5rem), gap (1rem) and row (3rem) added up.
 */
export default function HomeBanner({ banner }: { banner: HomeBannerData }) {
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
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner.imageUrl} alt={banner.title ?? ""} className="absolute inset-0 h-full w-full object-cover" />
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

  const cls = "relative block h-32 w-full overflow-hidden rounded-3xl bg-gradient-to-r from-brand to-brand-light";
  return internal || external ? (
    <button type="button" onClick={open} className={`tap ${cls}`} aria-label={banner.title ?? "Open banner"}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
