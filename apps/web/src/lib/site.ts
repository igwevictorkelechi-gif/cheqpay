/**
 * Canonical identity of the public site, in one place.
 *
 * Canonical URLs, the sitemap, robots.txt and the JSON-LD all have to agree on
 * the same origin and the same trailing-slash convention. When they disagree,
 * every page tells Google a URL that redirects to a different one, which is the
 * classic way a technically-fine site fails to consolidate its ranking signals.
 */

/** No trailing slash: paths are appended and bring their own. */
export const SITE_URL = "https://mycheqpay.com";

export const SITE_NAME = "CheqPay";

export const SUPPORT_EMAIL = "support@cheqpay.com";

/**
 * Build an absolute canonical URL for a route.
 *
 * `next.config` sets `trailingSlash: true` for the static export, so the file
 * actually served for /about is /about/index.html and the live URL is
 * "/about/". A canonical without the slash points at a URL that 301s, so it is
 * added here rather than remembered at each call site.
 */
export function canonical(path: string): string {
  if (path === "/" || path === "") return `${SITE_URL}/`;
  const clean = `/${path.replace(/^\/+|\/+$/g, "")}/`;
  return `${SITE_URL}${clean}`;
}

/** The public, indexable routes — the sitemap and robots.txt both read this. */
export const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/about/company",
  "/faq",
  "/contact",
  "/support",
  "/privacy",
  "/terms",
  "/legal",
  "/legal/aml",
  "/legal/cookies",
] as const;
