import type { MetadataRoute } from "next";
import { SITE_URL, PUBLIC_ROUTES } from "@/lib/site";

// Emitted as a static /robots.txt by `output: "export"`.
export const dynamic = "force-static";

/**
 * Most of this app is behind a login. Those routes prerender as empty shells,
 * and an empty shell in the index is worse than no page at all — it teaches
 * Google the site is thin. So the rule is inverted from the usual: allow the
 * handful of public pages, disallow everything else.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: PUBLIC_ROUTES.map((r) => (r === "/" ? "/$" : `${r}/`)),
        disallow: [
          "/account",
          "/asset/",
          "/bank-accounts",
          "/cards",
          "/convert",
          "/crypto",
          "/deposit",
          "/kyc",
          "/login",
          "/notifications",
          "/onboarding",
          "/pay-bill",
          "/personal-details",
          "/preferences",
          "/profile",
          "/receive",
          "/security",
          "/send-crypto",
          "/send-user",
          "/settings",
          "/signup",
          "/statement",
          "/transaction",
          "/transactions",
          "/two-factor",
          "/verify-otp",
          "/virtual-account",
          "/wallet-statement",
          "/withdraw",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
