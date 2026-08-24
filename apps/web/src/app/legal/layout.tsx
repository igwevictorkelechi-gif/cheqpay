import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "Legal",
  description:
    "CheqPay's policies in one place: terms of service, privacy, anti-money-laundering and cookies.",
  alternates: { canonical: canonical("/legal") },
  openGraph: {
    title: "Legal | CheqPay",
    description:
      "CheqPay's policies in one place: terms of service, privacy, anti-money-laundering and cookies.",
    url: canonical("/legal"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
