import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// Server layout beside the client page, which cannot export metadata itself.
export const metadata: Metadata = {
  title: "Pricing and fees",
  description:
    "Every CheqPay fee in one place: deposits, withdrawals, conversions, crypto and USD virtual cards. No hidden charges.",
  alternates: { canonical: canonical("/pricing") },
  openGraph: {
    title: "Pricing and fees | CheqPay",
    description:
      "Every CheqPay fee in one place: deposits, withdrawals, conversions, crypto and USD virtual cards. No hidden charges.",
    url: canonical("/pricing"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
