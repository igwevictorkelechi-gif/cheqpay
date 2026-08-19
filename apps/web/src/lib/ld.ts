import { SITE_NAME, SITE_URL, SUPPORT_EMAIL, canonical } from "./site";

/**
 * Structured data as plain objects.
 *
 * Data rather than components on purpose: the home page is a client component
 * and the FAQ's metadata lives in a server layout, so a JSX component would
 * have to be marked "use client" and hydrate for no reason. A `<script>` tag
 * built from these renders into the static HTML either way, which is all a
 * crawler needs.
 *
 * This is the one part of on-page SEO that changes how a result *looks* rather
 * than only where it ranks: FAQ markup can win extra space in the results page,
 * and Organization is what feeds a knowledge panel.
 */

export const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/cheqpay-logo.png`,
  description:
    "CheqPay is a Nigerian fintech offering Naira accounts, bank transfers, " +
    "bill payments and crypto trading in one verified account.",
  areaServed: { "@type": "Country", name: "Nigeria" },
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SUPPORT_EMAIL,
      availableLanguage: ["en"],
    },
  ],
} as const;

/** Lets Google show the site name rather than the bare domain. */
export const webSiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
} as const;

/**
 * Built from the same array the page renders, so the markup cannot drift from
 * what a visitor sees — schema that disagrees with the page is a manual-action
 * risk, not a ranking win.
 */
export function faqLd(items: readonly { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: canonical("/faq"),
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}
