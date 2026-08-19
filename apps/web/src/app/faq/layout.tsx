import type { Metadata } from "next";
import { canonical } from "@/lib/site";
import { faqLd } from "@/lib/ld";
import { FAQS } from "@/lib/faqs";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "Frequently asked questions",
  description:
    "How to fund a CheqPay account, buy and sell Bitcoin and USDT with Naira, pay bills, and get verified. Answers to the questions we hear most.",
  alternates: { canonical: canonical("/faq") },
  openGraph: {
    title: "Frequently asked questions | CheqPay",
    description:
      "How to fund a CheqPay account, buy and sell Bitcoin and USDT with Naira, pay bills, and get verified. Answers to the questions we hear most.",
    url: canonical("/faq"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        // Built from the same array the page renders — see lib/faqs.ts.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd(FAQS)) }}
      />
      {children}
    </>
  );
}
