"use client";

import { useState } from "react";

export interface BillerBrand {
  id: string;
  name: string;
  short: string;
  color: string;
  logo?: string | null;
}

/** Pick black/white text for best contrast on the given hex background. */
function contrastText(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Perceived luminance (sRGB).
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return l > 0.6 ? "#111111" : "#FFFFFF";
}

/**
 * Sleek brand tile for a biller. Renders the official logo image when `logo`
 * is set (drop assets in /public/billers/), otherwise a polished wordmark
 * chip in the brand colour.
 */
export default function BillerLogo({
  brand,
  size = 52,
  rounded = "2xl",
}: {
  brand: BillerBrand;
  size?: number;
  rounded?: "full" | "2xl";
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const radius = rounded === "full" ? "9999px" : Math.round(size * 0.28);
  const label = brand.short || brand.name;
  // Shrink the wordmark to fit longer labels inside the tile.
  const fontSize = Math.max(9, Math.min(size * 0.4, (size * 1.7) / label.length));

  if (brand.logo && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logo}
        alt={brand.name}
        onError={() => setImgFailed(true)}
        style={{ width: size, height: size, borderRadius: radius }}
        className="shrink-0 bg-white object-contain p-1.5 shadow-sm ring-1 ring-black/5"
      />
    );
  }

  return (
    <span
      aria-label={brand.name}
      className="flex shrink-0 select-none items-center justify-center font-extrabold tracking-tight shadow-sm ring-1 ring-white/10"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: brand.color,
        color: contrastText(brand.color),
        fontSize,
        lineHeight: 1,
      }}
    >
      {label}
    </span>
  );
}
