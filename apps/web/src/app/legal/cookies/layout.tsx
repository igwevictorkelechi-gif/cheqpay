import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "Cookie Policy",
  description:
    "The cookies and local storage CheqPay uses, what each is for, and how to control them.",
  alternates: { canonical: canonical("/legal/cookies") },
  openGraph: {
    title: "Cookie Policy | CheqPay",
    description:
      "The cookies and local storage CheqPay uses, what each is for, and how to control them.",
    url: canonical("/legal/cookies"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
