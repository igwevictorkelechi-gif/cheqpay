import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "About CheqPay",
  description:
    "CheqPay is a Nigerian fintech offering a Naira account number, transfers to any bank, bill payments and crypto trading in one verified account.",
  alternates: { canonical: canonical("/about") },
  openGraph: {
    title: "About CheqPay | CheqPay",
    description:
      "CheqPay is a Nigerian fintech offering a Naira account number, transfers to any bank, bill payments and crypto trading in one verified account.",
    url: canonical("/about"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
