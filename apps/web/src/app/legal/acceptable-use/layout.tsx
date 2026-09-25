import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description:
    "What you may and may not do with CheqPay — prohibited activities, account sharing, testing the platform, and what happens if the rules are broken.",
  alternates: { canonical: canonical("/legal/acceptable-use") },
  openGraph: {
    title: "Acceptable Use Policy | CheqPay",
    description:
      "What you may and may not do with CheqPay — prohibited activities, account sharing, testing the platform, and what happens if the rules are broken.",
    url: canonical("/legal/acceptable-use"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
