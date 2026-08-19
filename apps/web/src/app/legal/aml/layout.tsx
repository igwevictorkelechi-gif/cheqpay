import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "AML Policy",
  description:
    "CheqPay's anti-money-laundering and counter-terrorist-financing commitments, and the identity checks every account goes through.",
  alternates: { canonical: canonical("/legal/aml") },
  openGraph: {
    title: "AML Policy | CheqPay",
    description:
      "CheqPay's anti-money-laundering and counter-terrorist-financing commitments, and the identity checks every account goes through.",
    url: canonical("/legal/aml"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
