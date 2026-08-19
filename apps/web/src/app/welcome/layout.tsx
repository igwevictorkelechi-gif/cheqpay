import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// Canonical points at "/", not at this URL. Both render the same landing page;
// telling Google they are one page consolidates the ranking signals onto the
// root instead of splitting them across two addresses.
export const metadata: Metadata = {
  title: "Send money, buy crypto and pay bills in Nigeria",
  description:
    "CheqPay gives you a Naira account number, instant transfers to any Nigerian bank, " +
    "bill payments, and Bitcoin and USDT you can buy and sell at rates you see first.",
  alternates: { canonical: canonical("/") },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
