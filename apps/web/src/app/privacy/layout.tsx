import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How CheqPay collects, uses, stores and protects your personal data, and the rights you have over it.",
  alternates: { canonical: canonical("/privacy") },
  openGraph: {
    title: "Privacy Policy | CheqPay",
    description:
      "How CheqPay collects, uses, stores and protects your personal data, and the rights you have over it.",
    url: canonical("/privacy"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
