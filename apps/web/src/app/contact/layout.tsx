import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "Contact us",
  description:
    "Get in touch with the CheqPay team. Send a message, email support, or reach us through the channels listed here.",
  alternates: { canonical: canonical("/contact") },
  openGraph: {
    title: "Contact us | CheqPay",
    description:
      "Get in touch with the CheqPay team. Send a message, email support, or reach us through the channels listed here.",
    url: canonical("/contact"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
