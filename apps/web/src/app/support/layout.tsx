import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// A server layout beside the client page: a "use client" page cannot export
// metadata, so without this every route would inherit the root title and the
// whole site would look like one page to a search engine.
export const metadata: Metadata = {
  title: "Support",
  description:
    "Help with deposits, withdrawals, verification, bill payments and crypto on CheqPay. Reach a human when you need one.",
  alternates: { canonical: canonical("/support") },
  openGraph: {
    title: "Support | CheqPay",
    description:
      "Help with deposits, withdrawals, verification, bill payments and crypto on CheqPay. Reach a human when you need one.",
    url: canonical("/support"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
