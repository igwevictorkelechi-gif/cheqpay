import type { MetadataRoute } from "next";
import { SITE_URL, PUBLIC_ROUTES } from "@/lib/site";

// Emitted as a static /robots.txt by `output: "export"`.
export const dynamic = "force-static";

/**
 * Most of this app is behind a login. Those routes prerender as empty shells,
 * and an empty shell in the index is worse than no page at all — it teaches
 * Google the site is thin. So the rule is inverted from the usual: allow the
 * handful of public pages, disallow everything else.
 *
 * This used to be an enumerated disallow list, which did not match the
 * sentence above and could not: every private screen added since had to be
 * remembered, and several were not (/app-lock, /change-password,
 * /delete-account, /instant-withdrawal, /usd-account and /support/chat were
 * all crawlable). An allowlist cannot have that bug — a route is private
 * unless it is named public.
 *
 * Precedence note: this relies on the longest-match rule that Google and Bing
 * both implement, where a more specific Allow beats a broader Disallow. That
 * is what makes "Disallow: /" plus "Allow: /about/" mean what it looks like.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          ...PUBLIC_ROUTES.map((r) => (r === "/" ? "/$" : `${r}/`)),
          // Build output and static assets must stay crawlable even though
          // everything else is blocked. Google renders a page before judging
          // it, so blocking the CSS and JS would leave it grading a blank
          // screen — the exact outcome this file exists to avoid.
          "/_next/",
          "/fonts/",
          "/manifest.webmanifest",
          "/sitemap.xml",
          // Icons and the logo, referenced from the document head and from the
          // Organization JSON-LD — a blocked logo costs the knowledge panel.
          "/icon.png",
          "/apple-icon.png",
          "/favicon.ico",
          "/cheqpay-logo.png",
          "/cheqpay-logo-dark.png",
          "/cheqpay-icon.png",
          "/icon-192.png",
          "/icon-512.png",
        ],
        disallow: ["/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
