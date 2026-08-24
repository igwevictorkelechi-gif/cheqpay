import type { MetadataRoute } from "next";
import { canonical, PUBLIC_ROUTES } from "@/lib/site";

// Emitted as a static /sitemap.xml by `output: "export"`.
export const dynamic = "force-static";

/** Pages that carry the most weight get the higher priority. */
const PRIORITY: Record<string, number> = {
  "/": 1,
  "/about": 0.8,
  "/faq": 0.8,
  "/contact": 0.7,
  "/support": 0.7,
};

/**
 * Only the public routes. `/welcome` is deliberately absent: it renders the
 * same landing page as `/` and canonicalises to it, so listing both would ask
 * Google to index one page twice.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: canonical(route),
    lastModified,
    changeFrequency: route === "/" ? ("weekly" as const) : ("monthly" as const),
    priority: PRIORITY[route] ?? 0.5,
  }));
}
