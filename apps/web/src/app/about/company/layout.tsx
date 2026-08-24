import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "Our story",
  description:
    "Who CheqPay is, what we set out to build, and the standards we hold ourselves to as a Nigerian financial services company.",
  alternates: { canonical: canonical("/about/company") },
  openGraph: {
    title: "Our story | CheqPay",
    description:
      "Who CheqPay is, what we set out to build, and the standards we hold ourselves to as a Nigerian financial services company.",
    url: canonical("/about/company"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
