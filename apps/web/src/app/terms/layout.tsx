import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern your use of CheqPay's accounts, transfers, bill payments and crypto services.",
  alternates: { canonical: canonical("/terms") },
  openGraph: {
    title: "Terms of Service | CheqPay",
    description:
      "The terms that govern your use of CheqPay's accounts, transfers, bill payments and crypto services.",
    url: canonical("/terms"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
